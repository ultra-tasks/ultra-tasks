import { inject, Injectable } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { OAuthFlowConfig, OAuthTokenResult } from '@super-productivity/plugin-api';
import { MS_TODO_IMPORT_PLUGIN_ID, MS_TODO_OAUTH_CONFIG } from './ms-todo-import-oauth';
import { PluginOAuthService } from './plugin-oauth.service';
import { resolveEffectiveOAuthConfig } from './resolve-effective-oauth-config.util';
import {
  saveOAuthTokens,
  loadOAuthTokens,
  deleteOAuthTokens,
  deleteOAuthTokensByPrefix,
  moveOAuthTokens,
} from './plugin-oauth-token-store';
import { IS_ELECTRON } from '../../app.constants';
import {
  IS_NATIVE_PLATFORM,
  IS_IOS_NATIVE,
  IS_ANDROID_NATIVE,
} from '../../util/is-native-platform';
import { PluginLog } from '../../core/log';
import {
  GithubDeviceFlowService,
  GitHubDeviceAuthorization,
} from './github-device-flow.service';

/**
 * Bridges OAuth operations between plugin API surface and the underlying
 * PluginOAuthService + persistence layer. Extracted from PluginBridgeService
 * to keep that class focused.
 *
 * OAuth tokens are stored in a local-only IndexedDB database (NOT synced
 * via op-log). Each device authenticates independently.
 */
@Injectable({ providedIn: 'root' })
export class PluginOAuthBridgeService {
  private _pluginOAuthService = inject(PluginOAuthService);
  private readonly _githubDeviceFlow = inject(GithubDeviceFlowService);

  async startGithubDeviceFlow(
    clientId: string,
    tokenKey: string,
    onCode: (authorization: GitHubDeviceAuthorization) => void,
    signal: AbortSignal,
  ): Promise<void> {
    if (!IS_ELECTRON && !IS_NATIVE_PLATFORM)
      throw new Error('GitHub browser sign-in requires the desktop or mobile app.');
    const authorization = await this._githubDeviceFlow.requestCode(clientId, signal);
    onCode(authorization);
    this._openOAuthWindow(authorization.verificationUri);
    const tokens = await this._githubDeviceFlow.poll(clientId, authorization, signal);
    if (signal.aborted) throw new DOMException('Sign-in cancelled.', 'AbortError');
    const key = this._oauthPersistenceKey('github-issue-provider', tokenKey);
    this._pluginOAuthService.storeTokens(key, {
      ...tokens,
      clientId,
      tokenUrl: 'https://github.com/login/oauth/access_token',
    });
    await this._persistOAuthTokens(key);
    if (signal.aborted) {
      await this.clearOAuthToken('github-issue-provider', tokenKey);
      throw new DOMException('Sign-in cancelled.', 'AbortError');
    }
  }

  constructor() {
    // Clear persisted OAuth tokens once the authorization server rejects the grant
    this._pluginOAuthService.tokenInvalidated$
      .pipe(takeUntilDestroyed())
      .subscribe((pluginId) => {
        this._clearPersistedOAuthTokens(pluginId);
      });

    // Persist the rotated access token, so a restart does not immediately refresh again
    this._pluginOAuthService.tokensRefreshed$
      .pipe(takeUntilDestroyed())
      .subscribe((pluginId) => {
        this._persistOAuthTokens(pluginId);
      });
  }

  async startOAuthFlow(
    pluginId: string,
    config: OAuthFlowConfig,
    tokenKey?: string,
  ): Promise<OAuthTokenResult> {
    const { tokens, ...tokenConfig } = await this._authorize(pluginId, config);
    const scopedPluginId = this._oauthPersistenceKey(pluginId, tokenKey);
    this._pluginOAuthService.storeTokens(scopedPluginId, { ...tokens, ...tokenConfig });
    await this._persistOAuthTokens(scopedPluginId);
    return tokens;
  }

  /** One-time Microsoft import: keep the access token in memory, not in the token store. */
  async authorizeMsTodoImport(): Promise<string> {
    if (!MS_TODO_OAUTH_CONFIG)
      throw new Error('Microsoft To Do import is not configured.');
    const {
      tokens: { accessToken },
    } = await this._authorize(MS_TODO_IMPORT_PLUGIN_ID, MS_TODO_OAUTH_CONFIG);
    return accessToken;
  }

  private async _authorize(
    pluginId: string,
    config: OAuthFlowConfig,
  ): Promise<{
    tokens: OAuthTokenResult;
    tokenUrl: string;
    clientId: string;
    clientSecret?: string;
  }> {
    // Validate URLs before starting the loopback server. On Electron,
    // prepareRedirectUri() starts a server — avoid leaking it if config is invalid.
    this._pluginOAuthService.validateOAuthConfig(config);

    // Pick the platform-specific client id / secret / redirectUri. Extracted into a
    // pure, platform-parameterized util so every branch is unit-testable (the IS_*
    // consts are module-level and cannot be mocked in karma).
    const effectiveConfig = resolveEffectiveOAuthConfig(config, {
      isElectron: IS_ELECTRON,
      isNative: IS_NATIVE_PLATFORM,
      isAndroid: IS_ANDROID_NATIVE,
      isIos: IS_IOS_NATIVE,
    });

    if (config.clientSecret && !effectiveConfig.clientSecret) {
      PluginLog.warn(
        'OAuth: the configured client secret is not used on this platform; the public/platform client id is used instead.',
      );
    }

    const redirectUri = await this._pluginOAuthService.prepareRedirectUri(
      effectiveConfig.redirectUri,
    );
    const { url, codeVerifier, state } = await this._pluginOAuthService.buildAuthUrl(
      effectiveConfig,
      redirectUri,
    );

    this._openOAuthWindow(url);

    const code = await this._pluginOAuthService.waitForRedirectCode(pluginId, state);

    const tokens = await this._pluginOAuthService.exchangeCodeForTokens({
      tokenUrl: effectiveConfig.tokenUrl,
      clientId: effectiveConfig.clientId,
      code,
      codeVerifier,
      redirectUri,
      clientSecret: effectiveConfig.clientSecret,
    });

    return {
      tokens,
      tokenUrl: effectiveConfig.tokenUrl,
      clientId: effectiveConfig.clientId,
      clientSecret: effectiveConfig.clientSecret,
    };
  }

  async clearOAuthToken(pluginId: string, tokenKey?: string): Promise<void> {
    const scopedPluginId = this._oauthPersistenceKey(pluginId, tokenKey);
    this._pluginOAuthService.clearTokens(scopedPluginId);
    await this._clearPersistedOAuthTokens(scopedPluginId);
  }

  async clearOAuthTokens(pluginId: string): Promise<void> {
    const legacyKey = this._oauthPersistenceKey(pluginId);
    const scopedPrefix = `${legacyKey}__`;
    this._pluginOAuthService.clearTokens(legacyKey);
    this._pluginOAuthService.clearTokensByPrefix(scopedPrefix);
    await this._clearPersistedOAuthTokens(legacyKey);
    await deleteOAuthTokensByPrefix(scopedPrefix);
  }

  async migrateLegacyOAuthTokenToScopedKey(
    pluginId: string,
    tokenKey: string,
  ): Promise<boolean> {
    const legacyKey = this._oauthPersistenceKey(pluginId);
    const scopedKey = this._oauthPersistenceKey(pluginId, tokenKey);

    try {
      const serialized = await moveOAuthTokens(legacyKey, scopedKey);
      this._pluginOAuthService.clearTokens(legacyKey);
      if (!serialized) {
        return false;
      }
      // Steady state (nothing moved, scoped credential already in memory): do not
      // replace the live token object, or a refresh in flight is treated as stale.
      if (!this._pluginOAuthService.hasTokens(scopedKey)) {
        this._pluginOAuthService.restoreTokens(scopedKey, serialized);
      }
      return this._pluginOAuthService.hasTokens(scopedKey);
    } catch (error) {
      PluginLog.err('PluginOAuthBridge: Failed to migrate legacy OAuth tokens:', error);
      return false;
    }
  }

  async restoreAndCheckOAuthTokens(
    pluginId: string,
    config?: OAuthFlowConfig,
    tokenKey?: string,
  ): Promise<boolean> {
    if (this._isUnavailableInWeb(config)) {
      await this.clearOAuthToken(pluginId, tokenKey);
      return false;
    }
    const scopedPluginId = this._oauthPersistenceKey(pluginId, tokenKey);
    if (!this._pluginOAuthService.hasTokens(scopedPluginId)) {
      await this._restoreOAuthTokens(scopedPluginId);
    }
    return this._pluginOAuthService.hasTokens(scopedPluginId);
  }

  async getOAuthToken(
    pluginId: string,
    config?: OAuthFlowConfig,
    tokenKey?: string,
  ): Promise<string | null> {
    if (this._isUnavailableInWeb(config)) {
      await this.clearOAuthToken(pluginId, tokenKey);
      return null;
    }
    const scopedPluginId = this._oauthPersistenceKey(pluginId, tokenKey);
    if (!this._pluginOAuthService.hasTokens(scopedPluginId)) {
      await this._restoreOAuthTokens(scopedPluginId);
    }
    return this._pluginOAuthService.getValidToken(scopedPluginId);
  }

  private _isUnavailableInWeb(config?: OAuthFlowConfig): boolean {
    return !!config && !IS_ELECTRON && !IS_NATIVE_PLATFORM && !config.webClientId;
  }

  private _openOAuthWindow(url: string): void {
    if (IS_ELECTRON) {
      window.ea.pluginOAuthStart(url);
    } else if (IS_NATIVE_PLATFORM) {
      // On mobile, Google blocks OAuth in embedded WebViews (Error 400: invalid_request).
      // Use Capacitor Browser to open the system browser instead.
      import('@capacitor/browser').then(({ Browser }) =>
        Browser.open({ url, presentationStyle: 'popover' }),
      );
    } else {
      const popup = window.open(url, '_blank', 'width=600,height=700');
      if (!popup) {
        throw new Error('Popup blocked. Please allow popups for this site.');
      }
    }
  }

  private _oauthPersistenceKey(pluginId: string, tokenKey?: string): string {
    return tokenKey ? `${pluginId}__oauth__${tokenKey}` : `${pluginId}__oauth`;
  }

  private async _persistOAuthTokens(oauthKey: string): Promise<void> {
    const serialized = this._pluginOAuthService.serializeTokens(oauthKey);
    if (serialized) {
      try {
        await saveOAuthTokens(oauthKey, serialized);
      } catch (error) {
        PluginLog.err('PluginOAuthBridge: Failed to persist OAuth tokens:', error);
      }
    }
  }

  private async _restoreOAuthTokens(oauthKey: string): Promise<void> {
    try {
      const serialized = await loadOAuthTokens(oauthKey);
      if (serialized) {
        this._pluginOAuthService.restoreTokens(oauthKey, serialized);
      }
    } catch (error) {
      PluginLog.err('PluginOAuthBridge: Failed to restore OAuth tokens:', error);
    }
  }

  private async _clearPersistedOAuthTokens(oauthKey: string): Promise<void> {
    try {
      await deleteOAuthTokens(oauthKey);
    } catch (error) {
      PluginLog.err('PluginOAuthBridge: Failed to clear persisted OAuth tokens:', error);
    }
  }
}
