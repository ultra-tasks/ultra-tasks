import { app, ipcMain, safeStorage } from 'electron';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { readSecretFile, writeSecretFile } from './secure-file';
import { IPC } from './shared-with-frontend/ipc-events.const';

/** Pending login proofs only; no account password or unwrapped vault is persisted. */
export const initAccountLoginStore = (): void => {
  const file = (): string => join(app.getPath('userData'), 'account-login.enc');
  const available = (): void => {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('Protected account sign-in storage is unavailable');
  };
  ipcMain.handle(IPC.ACCOUNT_LOGIN_STORE, (event, method: unknown, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted sign-in request');
    if (method === 'clear') {
      rmSync(file(), { force: true });
      return;
    }
    if (method === 'load') {
      const encrypted = readSecretFile(file(), /^[A-Za-z0-9+/=]+$/, 'account sign-in');
      if (!encrypted) return null;
      available();
      const value = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
      const pending = JSON.parse(value) as { request?: { expiresAt?: number } };
      if (!pending.request?.expiresAt || pending.request.expiresAt <= Date.now()) {
        rmSync(file(), { force: true });
        return null;
      }
      return value;
    }
    if (method !== 'save' || typeof input !== 'string' || input.length > 16384)
      throw new Error('Invalid sign-in request');
    available();
    const pending = JSON.parse(input) as { request?: { expiresAt?: number } };
    if (
      !pending.request?.expiresAt ||
      pending.request.expiresAt <= Date.now() ||
      pending.request.expiresAt > Date.now() + 300000
    )
      throw new Error('Expired sign-in request');
    writeSecretFile(
      file(),
      safeStorage.encryptString(input).toString('base64'),
      'account sign-in',
    );
  });
};
