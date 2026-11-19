import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import type { AccountClient } from '@sp/sync-providers/ultra-tasks';
import { IS_ELECTRON } from '../../app.constants';

/**
 * Second step of a sign-in with a security key or passkey, for an account with two-factor
 * enrolled. On the account server's own origin the browser's WebAuthn prompt is used; on any
 * other origin (the apps) the key is used in the system browser and this polls for the result.
 * `finishLogin` opens the account once the server accepted the key, like every other sign-in.
 *
 * `current` names the account client the sign-in belongs to, so a sign-in that was abandoned
 * (Back, a lock) stops waiting.
 */
export const signInWithPasskey = async (
  account: AccountClient,
  serverUrl: string,
  current: () => AccountClient | undefined,
  finishLogin: () => Promise<void>,
): Promise<void> => {
  if (location.origin !== new URL(serverUrl).origin) {
    if (!account.capabilities?.features['browserMfa'])
      throw new Error('NATIVE_SYNC.ERROR_SERVER_UPDATE');
    const flow = await account.startBrowserMfa();
    if (new URL(flow.url).origin !== new URL(serverUrl).origin)
      throw new Error('NATIVE_SYNC.ERROR_PASSKEY');
    if (Capacitor.isNativePlatform()) await Browser.open({ url: flow.url });
    else if (IS_ELECTRON) window.ea.openExternalUrl(flow.url);
    else window.open(flow.url, '_blank', 'noopener,noreferrer');
    const deadline = Date.now() + 180000;
    while (current() === account && Date.now() < deadline) {
      if (await account.pollBrowserMfa(flow)) {
        if (Capacitor.isNativePlatform()) await Browser.close().catch(() => undefined);
        await finishLogin();
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error('NATIVE_SYNC.ERROR_PASSKEY');
  }
  const { options, credentialToken } = await account.webauthnLoginOptions();
  const credentialClass = PublicKeyCredential as typeof PublicKeyCredential & {
    parseRequestOptionsFromJSON(options: object): PublicKeyCredentialRequestOptions;
  };
  if (!credentialClass.parseRequestOptionsFromJSON)
    throw new Error('NATIVE_SYNC.ERROR_PASSKEY');
  const credential = (await navigator.credentials.get({
    publicKey: credentialClass.parseRequestOptionsFromJSON(options),
  })) as (PublicKeyCredential & { toJSON(): unknown }) | null;
  if (!credential) throw new Error('NATIVE_SYNC.ERROR_PASSKEY');
  await account.completeWebauthn(credentialToken, credential.toJSON());
  await finishLogin();
};
