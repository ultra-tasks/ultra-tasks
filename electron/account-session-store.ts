import { app, ipcMain, safeStorage } from 'electron';
import { warn } from 'electron-log/main';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { readSecretFile, writeSecretFile } from './secure-file';
import { IPC } from './shared-with-frontend/ipc-events.const';
import type { StoredAccountSession } from './shared-with-frontend/account-session-api';

const MAX_SESSION_LENGTH = 4096;
/** A 32-byte key in base64url: the account's master key. */
const KEY = /^[A-Za-z0-9_-]{43}$/;
/**
 * An opaque credential issued by the server (refresh token, device token). The server's own
 * format has changed before (43 characters, then 48 with a self-identifying layout), so only
 * the alphabet and a sane bound are checked here: a stricter pin would silently stop the
 * session from being remembered the day the format moves again.
 */
const CREDENTIAL = /^[A-Za-z0-9_-]{32,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isServerUrl = (value: unknown): boolean => {
  if (typeof value !== 'string' || value.length > 256) return false;
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' &&
          ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  } catch {
    return false;
  }
};

/** The one shape main will encrypt or hand back; anything else is treated as absent. */
export const parseAccountSession = (value: string): StoredAccountSession | null => {
  try {
    const session = JSON.parse(value) as Partial<StoredAccountSession>;
    const valid =
      session.v === 1 &&
      isServerUrl(session.serverUrl) &&
      typeof session.accountId === 'string' &&
      UUID.test(session.accountId) &&
      typeof session.serverId === 'string' &&
      UUID.test(session.serverId) &&
      typeof session.masterKey === 'string' &&
      KEY.test(session.masterKey) &&
      typeof session.refreshToken === 'string' &&
      CREDENTIAL.test(session.refreshToken) &&
      (session.deviceToken === undefined ||
        (typeof session.deviceToken === 'string' &&
          CREDENTIAL.test(session.deviceToken)));
    return valid ? (session as StoredAccountSession) : null;
  } catch {
    return null;
  }
};

/**
 * The unlocked account of a trusted desktop device, encrypted with the OS credential store
 * (DPAPI, Keychain, libsecret). Same availability rule as the pending-login store: a Linux
 * `basic_text` backend is plaintext and is refused. Unavailability is reported, never
 * treated as "nothing stored", so the renderer keeps the configured account and never
 * clears credentials it could not read.
 */
export const initAccountSessionStore = (): void => {
  const file = (): string => join(app.getPath('userData'), 'account-session.enc');
  const available = (): void => {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('Protected account session storage is unavailable');
  };
  ipcMain.handle(IPC.ACCOUNT_SESSION_STORE, (event, method: unknown, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted account session request');
    if (method === 'clear') {
      rmSync(file(), { force: true });
      return;
    }
    if (method === 'load') {
      const encrypted = readSecretFile(file(), /^[A-Za-z0-9+/=]+$/, 'account session');
      if (!encrypted) return null;
      available();
      let value: string;
      try {
        value = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      } catch {
        // The OS credential store changed or is locked. Say so; keep the file untouched.
        warn('[account-session] The stored session could not be decrypted');
        throw new Error('Protected account session storage is unavailable');
      }
      if (!parseAccountSession(value)) {
        warn('[account-session] Ignoring a stored session with an unexpected shape');
        return null;
      }
      return value;
    }
    if (
      method !== 'save' ||
      typeof input !== 'string' ||
      input.length > MAX_SESSION_LENGTH ||
      !parseAccountSession(input)
    )
      throw new Error('Invalid account session request');
    available();
    writeSecretFile(
      file(),
      safeStorage.encryptString(input).toString('base64'),
      'account session',
    );
  });
};
