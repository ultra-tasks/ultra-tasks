import { inject, Injectable } from '@angular/core';
import type { AccountClient } from '@sp/sync-providers/ultra-tasks';
import { IS_ELECTRON_TOKEN } from '../../app.constants';
import { NativeSessionStoreService } from './native-session-store.service';

/** An opaque 256-bit marker in base64url, as the account server issues it. */
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;
const ACCOUNT_KEY = /^[0-9a-f]{64}$/;
const STORAGE_KEY = 'ultra-native-device-trust';
const MAX_NAMES = 4;
/** A person has a handful of accounts: the least recently used marker goes first. */
const MAX_ENTRIES = 32;

interface Entry {
  /** Server ID. */
  s: string;
  /** SHA-256 of the lower-cased name the account signs in with. */
  k: string;
  t: string;
  /** Last time the marker was stored (ms since epoch). */
  u: number;
}

/** Hex SHA-256 of a name: the account's email is never kept in the clear next to its marker. */
export const deviceTrustKey = async (name: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(name.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
};

const isEntry = (value: unknown): value is Entry => {
  const entry = value as Partial<Entry> | null;
  return (
    !!entry &&
    typeof entry.s === 'string' &&
    entry.s.length > 0 &&
    entry.s.length <= 64 &&
    typeof entry.k === 'string' &&
    ACCOUNT_KEY.test(entry.k) &&
    typeof entry.t === 'string' &&
    DEVICE_TOKEN.test(entry.t) &&
    typeof entry.u === 'number'
  );
};

/** An account as the trust marker knows it: its server and every name it signs in with. */
export interface TrustedAccount {
  serverId: string;
  names: (string | undefined)[];
}

/**
 * The marker that lets this installation skip the emailed code on a password sign-in. The
 * server issues it when it first trusts the device and never echoes it again, so it is kept
 * per account (by server and by hashed email) and presented at every password sign-in.
 *
 * It is a convenience, never a requirement: nothing here throws, and a store that refuses
 * only costs one more emailed code. Signing out keeps it (the device stays recognised);
 * deleting the account forgets it. The desktop app keeps it in OS-protected storage and
 * never in renderer storage; other platforms use `localStorage` (per viewer, as the account
 * server's own dashboard does).
 */
@Injectable({ providedIn: 'root' })
export class NativeDeviceTrustService {
  private readonly sessions = inject(NativeSessionStoreService);
  private readonly isElectron = inject(IS_ELECTRON_TOKEN);

  /** The marker held for the account, to present at a password sign-in. */
  async recall(
    serverId: string,
    names: readonly (string | undefined)[],
  ): Promise<string | undefined> {
    try {
      const keys = await this.keysOf(names);
      if (!keys.length) return undefined;
      if (this.isElectron)
        return (await this.sessions.loadDeviceToken({ serverId, keys })) ?? undefined;
      const entries = this.read();
      for (const key of keys) {
        const found = entries.find((entry) => entry.s === serverId && entry.k === key);
        if (found) return found.t;
      }
    } catch {
      /* Unreadable trust is the same as none. */
    }
    return undefined;
  }

  /**
   * After a sign-in the SDK holds this device's marker: the one the server just issued (shown
   * only once, so it is kept before anything else can fail) or the one that was presented.
   * `typed` is what the person typed to sign in, which can differ from the email.
   */
  async rememberFrom(account: AccountClient | undefined, typed?: string): Promise<void> {
    const trusted = this.whoIs(account, typed);
    if (trusted && account?.deviceToken)
      await this.remember(trusted.serverId, trusted.names, account.deviceToken);
  }

  /** The account's server and names. Note them before deleting it: the SDK forgets them then. */
  whoIs(account: AccountClient | undefined, typed?: string): TrustedAccount | undefined {
    const serverId = account?.capabilities?.serverId;
    return serverId ? { serverId, names: [account?.account?.email, typed] } : undefined;
  }

  /** Keeps `token` for the account under every name it is known by. */
  async remember(
    serverId: string,
    names: readonly (string | undefined)[],
    token: string,
  ): Promise<void> {
    if (!DEVICE_TOKEN.test(token)) return;
    try {
      const keys = await this.keysOf(names);
      if (!keys.length) return;
      if (this.isElectron) {
        await this.sessions.saveDeviceToken({ serverId, keys, token });
        return;
      }
      const now = Date.now();
      const others = this.read().filter(
        (entry) => !(entry.s === serverId && keys.includes(entry.k)),
      );
      this.write(
        [...keys.map((k): Entry => ({ s: serverId, k, t: token, u: now })), ...others]
          .sort((a, b) => b.u - a.u)
          .slice(0, MAX_ENTRIES),
      );
    } catch {
      /* One more emailed code, nothing worse. */
    }
  }

  /** Deleting the account is the one thing that forgets its marker. */
  async forget(trusted: TrustedAccount | undefined): Promise<void> {
    if (!trusted) return;
    const { serverId, names } = trusted;
    try {
      const keys = await this.keysOf(names);
      if (!keys.length) return;
      if (this.isElectron) {
        await this.sessions.forgetDeviceToken({ serverId, keys });
        return;
      }
      this.write(
        this.read().filter((entry) => !(entry.s === serverId && keys.includes(entry.k))),
      );
    } catch {
      /* Nothing readable to forget. */
    }
  }

  private async keysOf(names: readonly (string | undefined)[]): Promise<string[]> {
    const wanted = [
      ...new Set(
        names
          .map((name) => name?.trim().toLowerCase())
          .filter((name): name is string => !!name),
      ),
    ].slice(0, MAX_NAMES);
    return Promise.all(wanted.map((name) => deviceTrustKey(name)));
  }

  private read(): Entry[] {
    try {
      const file = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as {
        v?: number;
        entries?: unknown;
      } | null;
      return file?.v === 1 && Array.isArray(file.entries)
        ? (file.entries as unknown[]).filter(isEntry)
        : [];
    } catch {
      return [];
    }
  }

  private write(entries: Entry[]): void {
    try {
      if (entries.length)
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, entries }));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* A full or blocked storage only loses the convenience. */
    }
  }
}
