import type {
  AccountBundle,
  AccountInfo,
  Capabilities,
  Envelope,
} from '@sp/sync-providers/ultra-tasks';

export interface CachedAccount {
  capabilities: Capabilities;
  account: AccountInfo;
  bundle: AccountBundle;
  refresh: Envelope;
}

export const accountCacheKey = (
  serverUrl = localStorage.getItem('ultra-native-server') ?? '',
): string => 'ultra-native-account:' + serverUrl;

export const cachedAccountIdentity = (): { email: string; id: string } | null => {
  try {
    const raw = localStorage.getItem(accountCacheKey());
    const account = raw ? (JSON.parse(raw) as CachedAccount).account : undefined;
    return account?.email && account.id ? { email: account.email, id: account.id } : null;
  } catch {
    return null;
  }
};

/** Device-local account flags. Only recovery requires a durable write before proceeding. */
export class NativeAccountLocalFlags {
  constructor(private readonly accountId: () => string | undefined) {}

  private key(name: string): string {
    return `ultra-native-${name}:${this.accountId() ?? ''}`;
  }

  read(name: string): string | null {
    try {
      return localStorage.getItem(this.key(name));
    } catch {
      return null;
    }
  }

  write(name: string, value: string | null): void {
    try {
      if (value === null) localStorage.removeItem(this.key(name));
      else localStorage.setItem(this.key(name), value);
    } catch {
      /* Deferral and last-sync flags are conveniences. */
    }
  }

  markRecovering(scopeId: string): void {
    localStorage.setItem(this.key('recovering'), scopeId);
  }
}
