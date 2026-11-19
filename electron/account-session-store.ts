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
 * An opaque credential issued by the server (refresh token). The server's own format has
 * changed before (43 characters, then 48 with a self-identifying layout), so only the
 * alphabet and a sane bound are checked here: a stricter pin would silently stop the
 * session from being remembered the day the format moves again.
 */
const CREDENTIAL = /^[A-Za-z0-9_-]{32,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** New-device trust markers: opaque 256-bit tokens, one per signed-in account. */
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
/** SHA-256 of the lower-cased account identifier, hex: the account is never stored in the clear. */
const DEVICE_KEY = /^[0-9a-f]{64}$/;
const MAX_DEVICE_REQUEST_LENGTH = 1024;
const MAX_DEVICE_KEYS = 4;
/** The least recently used marker is dropped first; a person has a handful of accounts. */
const MAX_DEVICE_ENTRIES = 64;

interface DeviceEntry {
  /** Server ID. */
  s: string;
  /** Account key. */
  k: string;
  /** The device token. */
  t: string;
  /** Last time this marker was stored (ms since epoch). */
  u: number;
}

interface DeviceRequest {
  serverId: string;
  keys: string[];
  token?: string;
}

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
      CREDENTIAL.test(session.refreshToken);
    return valid ? (session as StoredAccountSession) : null;
  } catch {
    return null;
  }
};

/** A device-trust request: the server, up to a few account keys, and (to store) the token. */
const parseDeviceRequest = (input: unknown, withToken: boolean): DeviceRequest | null => {
  if (typeof input !== 'string' || input.length > MAX_DEVICE_REQUEST_LENGTH) return null;
  try {
    const request = JSON.parse(input) as Partial<DeviceRequest>;
    const keys = request.keys;
    const valid =
      typeof request.serverId === 'string' &&
      UUID.test(request.serverId) &&
      Array.isArray(keys) &&
      keys.length >= 1 &&
      keys.length <= MAX_DEVICE_KEYS &&
      keys.every((key) => typeof key === 'string' && DEVICE_KEY.test(key)) &&
      (withToken
        ? typeof request.token === 'string' && DEVICE_TOKEN.test(request.token)
        : request.token === undefined);
    return valid ? (request as DeviceRequest) : null;
  } catch {
    return null;
  }
};

const parseDeviceEntries = (value: string): DeviceEntry[] | null => {
  try {
    const file = JSON.parse(value) as { v?: number; entries?: unknown };
    if (file.v !== 1 || !Array.isArray(file.entries)) return null;
    const entries = (file.entries as Partial<DeviceEntry>[]).filter(
      (entry): entry is DeviceEntry =>
        typeof entry?.s === 'string' &&
        UUID.test(entry.s) &&
        typeof entry.k === 'string' &&
        DEVICE_KEY.test(entry.k) &&
        typeof entry.t === 'string' &&
        DEVICE_TOKEN.test(entry.t) &&
        typeof entry.u === 'number' &&
        Number.isFinite(entry.u),
    );
    return entries;
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
 *
 * The same door keeps the new-device trust markers (`device-*` requests) in a second
 * encrypted file. They are separate on purpose: signing out forgets the session, but the
 * device stays recognised, so the next sign-in does not ask for another emailed code. Only
 * deleting the account removes its marker.
 */
export const initAccountSessionStore = (): void => {
  const file = (): string => join(app.getPath('userData'), 'account-session.enc');
  const deviceFile = (): string => join(app.getPath('userData'), 'account-devices.enc');
  const available = (): void => {
    if (
      !safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' &&
        safeStorage.getSelectedStorageBackend() === 'basic_text')
    )
      throw new Error('Protected account session storage is unavailable');
  };
  /** Every stored marker; unreadable is reported (never "none") so nothing is overwritten. */
  const readDevices = (): DeviceEntry[] => {
    const encrypted = readSecretFile(
      deviceFile(),
      /^[A-Za-z0-9+/=]+$/,
      'account device trust',
    );
    if (!encrypted) return [];
    available();
    let value: string;
    try {
      value = safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    } catch {
      warn('[account-session] The stored device trust could not be decrypted');
      throw new Error('Protected account session storage is unavailable');
    }
    const entries = parseDeviceEntries(value);
    if (!entries)
      warn('[account-session] Ignoring stored device trust of an unexpected shape');
    return entries ?? [];
  };
  const writeDevices = (entries: DeviceEntry[]): void => {
    if (!entries.length) {
      rmSync(deviceFile(), { force: true });
      return;
    }
    available();
    writeSecretFile(
      deviceFile(),
      safeStorage.encryptString(JSON.stringify({ v: 1, entries })).toString('base64'),
      'account device trust',
    );
  };
  const handleDevice = (method: string, input: unknown): string | null | void => {
    const request = parseDeviceRequest(input, method === 'device-save');
    if (!request) throw new Error('Invalid account session request');
    const mine = (entry: DeviceEntry): boolean =>
      entry.s === request.serverId && request.keys.includes(entry.k);
    if (method === 'device-load') {
      const entries = readDevices();
      for (const key of request.keys) {
        const found = entries.find(
          (entry) => entry.s === request.serverId && entry.k === key,
        );
        if (found) return found.t;
      }
      return null;
    }
    if (method === 'device-forget') {
      const entries = readDevices();
      if (entries.some(mine)) writeDevices(entries.filter((entry) => !mine(entry)));
      return;
    }
    // device-save: the same token under each key the account is known by.
    const now = Date.now();
    const kept = readDevices().filter((entry) => !mine(entry));
    const added = request.keys.map(
      (k): DeviceEntry => ({ s: request.serverId, k, t: request.token!, u: now }),
    );
    writeDevices(
      [...added, ...kept].sort((a, b) => b.u - a.u).slice(0, MAX_DEVICE_ENTRIES),
    );
  };
  ipcMain.handle(IPC.ACCOUNT_SESSION_STORE, (event, method: unknown, input: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error('Untrusted account session request');
    if (
      method === 'device-load' ||
      method === 'device-save' ||
      method === 'device-forget'
    )
      return handleDevice(method, input);
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
