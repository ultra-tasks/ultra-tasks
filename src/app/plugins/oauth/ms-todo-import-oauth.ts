import { OAuthFlowConfig } from '@super-productivity/plugin-api';
import { IS_ELECTRON } from '../../app.constants';
import { getEnvOptional } from '../../util/env';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';

export const MS_TODO_IMPORT_PLUGIN_ID = 'ms-todo-import';

const MICROSOFT_LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';

export const buildMsTodoOAuthConfig = (
  clientId?: string,
): OAuthFlowConfig | undefined => {
  const id = clientId?.trim();
  if (!id || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) {
    return undefined;
  }
  return {
    authUrl: `${MICROSOFT_LOGIN}/authorize`,
    tokenUrl: `${MICROSOFT_LOGIN}/token`,
    clientId: id,
    webClientId: id,
    // This import neither writes to Microsoft nor needs background access.
    scopes: ['Tasks.Read'],
    extraAuthParams: { prompt: 'select_account' },
  };
};

export const isMsTodoOAuthAvailable = (
  desktop: boolean,
  native: boolean,
  origin: string,
  registeredWebOrigin?: string,
): boolean =>
  !native &&
  (desktop ||
    (origin === registeredWebOrigin?.trim() &&
      /^(https:\/\/|http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$)/.test(origin)));

export const MS_TODO_OAUTH_CONFIG = isMsTodoOAuthAvailable(
  IS_ELECTRON,
  IS_NATIVE_PLATFORM,
  window.location.origin,
  getEnvOptional('ULTRA_MS_TODO_WEB_ORIGIN'),
)
  ? buildMsTodoOAuthConfig(getEnvOptional('ULTRA_MS_TODO_OAUTH_CLIENT_ID'))
  : undefined;
