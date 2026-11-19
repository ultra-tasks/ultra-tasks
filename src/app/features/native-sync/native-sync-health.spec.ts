import { AccountApiError, type SyncClient } from '@sp/sync-providers/ultra-tasks';
import {
  classifyFailure,
  countPendingChanges,
  MAX_PENDING_COUNT,
  NativeSyncHealth,
} from './native-sync-health';

const clientWith = (
  scopes: Record<string, { intents: unknown[]; uncertain?: unknown; revoked?: boolean }>,
): SyncClient => ({ state: { scopes } }) as unknown as SyncClient;

describe('classifyFailure', () => {
  it('reads an unreachable server or network as offline, never as a revocation', () => {
    for (const error of [
      new TypeError('Failed to fetch'),
      new TypeError('Account server request timed out'),
      new TypeError('NetworkError when attempting to fetch resource.'),
      new TypeError('Load failed'),
      new Error('Failed to fetch'),
      'Account server request timed out',
    ])
      expect(classifyFailure(error)).toBe('offline');
  });

  it('reads a gateway error or a proxy page as offline, but a plain server error as a failure', () => {
    for (const status of [408, 429, 502, 503, 504])
      expect(classifyFailure(new AccountApiError(status, 'busy'))).toBe('offline');
    expect(classifyFailure(new AccountApiError(500, 'oops'))).toBe('other');
    expect(
      classifyFailure(
        new SyntaxError('Unexpected token \'<\', "<html>" is not valid JSON'),
      ),
    ).toBe('offline');
  });

  it('only an HTTP 401 from the account API means the session is gone', () => {
    expect(classifyFailure(new AccountApiError(401, 'Unauthorized'))).toBe('auth');
    expect(classifyFailure(new AccountApiError(403, 'Forbidden'))).toBe('other');
    expect(classifyFailure(new Error('Unauthorized'))).toBe('other');
  });

  it('does not hide a programming error behind "offline"', () => {
    expect(
      classifyFailure(new TypeError("Cannot read properties of undefined (reading 'x')")),
    ).toBe('other');
    expect(classifyFailure(new TypeError('x is not a function'))).toBe('other');
  });

  it('recognises data that could not be verified or validated', () => {
    expect(classifyFailure(new Error('Malformed personal document'))).toBe('data');
    expect(classifyFailure(new Error('NATIVE_SYNC.ERROR_DATA'))).toBe('data');
    expect(classifyFailure('Scope authentication failed')).toBe('data');
  });
});

describe('countPendingChanges', () => {
  it('counts unsent intents and an unanswered mutation, without content', () => {
    expect(
      countPendingChanges(
        clientWith({
          personal: { intents: [{}, {}], uncertain: {} },
          project: { intents: [{}] },
        }),
      ),
    ).toBe(4);
  });

  it('ignores a dataset whose access was revoked', () => {
    expect(
      countPendingChanges(clientWith({ gone: { intents: [{}], revoked: true } })),
    ).toBe(0);
  });

  it('is bounded and tolerates a client that is not open', () => {
    expect(
      countPendingChanges(
        clientWith({ personal: { intents: new Array(MAX_PENDING_COUNT + 50).fill({}) } }),
      ),
    ).toBe(MAX_PENDING_COUNT);
    expect(countPendingChanges(undefined)).toBe(0);
  });
});

describe('NativeSyncHealth', () => {
  it('counts an edit that is not captured yet as one pending change until it is captured', () => {
    const health = new NativeSyncHealth();
    const client = clientWith({ personal: { intents: [] } });
    health.noteLocalEdit(client);
    expect(health.pendingChanges()).toBe(1);
    (client.state.scopes as Record<string, { intents: unknown[] }>)[
      'personal'
    ].intents.push({});
    health.captured(client);
    expect(health.pendingChanges()).toBe(1);
    (client.state.scopes as Record<string, { intents: unknown[] }>)[
      'personal'
    ].intents.length = 0;
    health.refreshPending(client);
    expect(health.pendingChanges()).toBe(0);
  });

  it('success clears offline and the sign-in-again flag; failure sets only what happened', () => {
    const health = new NativeSyncHealth();
    health.failed('offline');
    expect(health.offline()).toBeTrue();
    expect(health.reauth()).toBeFalse();
    health.failed('other');
    expect(health.offline()).toBeFalse();
    health.failed('auth');
    expect(health.reauth()).toBeTrue();
    health.succeeded(123);
    expect(health.lastSyncedAt()).toBe(123);
    expect(health.offline()).toBeFalse();
    expect(health.reauth()).toBeFalse();
  });

  it('a failure never rewrites when the last success was', () => {
    const health = new NativeSyncHealth();
    health.succeeded(1000);
    health.failed('offline');
    health.failed('other');
    expect(health.lastSyncedAt()).toBe(1000);
  });

  it('reset forgets everything', () => {
    const health = new NativeSyncHealth();
    health.succeeded(5);
    health.failed('auth');
    health.emptyAccount.set(true);
    health.reset();
    expect(health.lastSyncedAt()).toBeNull();
    expect(health.reauth()).toBeFalse();
    expect(health.emptyAccount()).toBeFalse();
    expect(health.pendingChanges()).toBe(0);
  });
});
