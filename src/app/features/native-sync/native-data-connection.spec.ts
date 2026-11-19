import { signal } from '@angular/core';
import type { ScopeInfo, SyncClient } from '@sp/sync-providers/ultra-tasks';
import {
  ERROR_LOCAL_CHANGED,
  ERROR_REMOTE_CHANGED,
  NativeDataConnection,
  type DataConnectionHost,
} from './native-data-connection';
import type { AccountDataSummary } from './account-sync.types';

const personal = (over: Partial<ScopeInfo> = {}): ScopeInfo =>
  ({
    id: 'personal',
    kind: 'personal',
    state: 'active',
    sequence: 3,
    generation: 1,
    controlVersion: 1,
    ...over,
  }) as ScopeInfo;

const nothing: AccountDataSummary = {
  tasks: 0,
  projects: 0,
  notes: 0,
  archived: 0,
  hasUserData: false,
};
const something: AccountDataSummary = { ...nothing, tasks: 4, hasUserData: true };

interface Rig {
  connection: NativeDataConnection;
  client: jasmine.SpyObj<Pick<SyncClient, 'refreshScopes' | 'syncScope'>> & {
    state: {
      scopes: Record<string, { info: ScopeInfo }>;
      migrations: Record<string, unknown>;
    };
  };
  host: jasmine.SpyObj<DataConnectionHost> & {
    scopes: ReturnType<typeof signal<ScopeInfo[]>>;
    deferred: { read: jasmine.Spy; write: jasmine.Spy };
  };
  setLocal: (summary: AccountDataSummary) => void;
  setAccount: (summary: AccountDataSummary) => void;
  linkCalls: () => [boolean, boolean | undefined][];
  /** Every edit watch the planner started, in order. */
  watches: { changed: boolean; stop: jasmine.Spy }[];
  /** What happened, in order: 'watch', 'measure', 'bind', 'link'. */
  steps: string[];
}

const rig = (
  options: {
    local?: AccountDataSummary;
    account?: AccountDataSummary;
    scopes?: ScopeInfo[];
    deferred?: boolean;
  } = {},
): Rig => {
  let local = options.local ?? nothing;
  let account = options.account ?? something;
  let linked = false;
  const watches: Rig['watches'] = [];
  const steps: string[] = [];
  const scopes = signal<ScopeInfo[]>([]);
  const client = {
    refreshScopes: jasmine
      .createSpy('refreshScopes')
      .and.resolveTo(options.scopes ?? [personal()]),
    syncScope: jasmine.createSpy('syncScope').and.resolveTo(),
    state: {
      scopes: { personal: { info: personal() } },
      migrations: {} as Record<string, unknown>,
    },
  } as unknown as Rig['client'];
  const host = {
    client: () => client as unknown as SyncClient,
    linked: () => linked,
    scopes,
    bind: jasmine.createSpy('bind').and.callFake(async () => {
      steps.push('bind');
      return false;
    }),
    summary: {
      local: () => {
        steps.push('measure');
        return Promise.resolve(local);
      },
      fromRecords: () => account,
    },
    link: jasmine.createSpy('link').and.callFake(async () => {
      steps.push('link');
      linked = true;
    }),
    watchEdits: () => {
      steps.push('watch');
      const watch = { changed: false, stop: jasmine.createSpy('stop') };
      watches.push(watch);
      return watch;
    },
    serverHasPersonalScope: jasmine
      .createSpy('serverHasPersonalScope')
      .and.resolveTo(false),
    fail: jasmine.createSpy('fail').and.returnValue({ sessionLost: false }),
    deferred: {
      read: jasmine.createSpy('read').and.returnValue(!!options.deferred),
      write: jasmine.createSpy('write'),
    },
    showWorkspace: jasmine.createSpy('showWorkspace'),
  } as unknown as Rig['host'];
  return {
    connection: new NativeDataConnection(host),
    client,
    host,
    setLocal: (summary) => (local = summary),
    setAccount: (summary) => (account = summary),
    linkCalls: () =>
      (host.link as jasmine.Spy).calls
        .allArgs()
        .map(([migrate, automatic]) => [migrate, automatic]) as [
        boolean,
        boolean | undefined,
      ][],
    watches,
    steps,
  };
};

describe('NativeDataConnection', () => {
  describe('an empty device and a populated account', () => {
    it('downloads the account by itself and takes the person to their tasks', async () => {
      const r = rig({ local: nothing, account: something });
      await r.connection.connect();
      expect(r.linkCalls()).toEqual([[false, true]]);
      expect(r.host.showWorkspace).toHaveBeenCalledTimes(1);
      expect(r.connection.choice()).toBeNull();
      expect(r.connection.stage()).toBe('idle');
    });

    it('binds, then downloads inside the engine switch, without fetching beforehand', async () => {
      // The engine's guarded switch owns the fetch, so an edit at any moment of the
      // download is noticed by its checks. A separate fetch here would leave a window.
      const order: string[] = [];
      const r = rig();
      (r.host.bind as jasmine.Spy).and.callFake(async () => {
        order.push('bind');
        return false;
      });
      r.client.syncScope.and.callFake(async () => {
        order.push('syncScope');
      });
      (r.host.link as jasmine.Spy).and.callFake(async () => {
        order.push('link');
      });
      await r.connection.connect();
      expect(order).toEqual(['bind', 'link']);
    });

    it('measures this device before it touches the account', async () => {
      const order: string[] = [];
      const r = rig();
      (r.host.bind as jasmine.Spy).and.callFake(async () => {
        order.push('bind');
        return false;
      });
      (r.host.summary as { local: () => Promise<AccountDataSummary> }).local =
        async () => {
          order.push('measure');
          return nothing;
        };
      await r.connection.connect();
      expect(order.slice(0, 2)).toEqual(['measure', 'bind']);
    });

    it('stays on the automatic path whatever else the device has enabled', async () => {
      // A file or server provider is retired by the engine's switch, not by a prompt:
      // the planner never asks about it, so the account is connected for every device.
      const r = rig({ local: nothing, account: something });
      await r.connection.connect();
      expect(r.host.link).toHaveBeenCalledTimes(1);
      expect(r.connection.choice()).toBeNull();
    });

    it('a download that fails validation keeps the device unconnected and creates nothing', async () => {
      const r = rig({ local: nothing, account: something });
      const broken = new Error('NATIVE_SYNC.ERROR_DATA');
      (r.host.link as jasmine.Spy).and.rejectWith(broken);
      await r.connection.connect();
      expect(r.host.fail).toHaveBeenCalledWith(broken);
      expect(r.connection.stage()).toBe('failed');
      expect(r.connection.needsRetry()).toBeTrue();
      expect(r.connection.choice()).toBeNull();
      expect(r.host.showWorkspace).not.toHaveBeenCalled();
    });
  });

  describe('an edit between measuring a device and switching it', () => {
    it('is watched for from BEFORE the device is measured, and handed to the switch', async () => {
      const r = rig({ local: nothing, account: something });
      await r.connection.connect();
      expect(r.steps).toEqual(['watch', 'measure', 'bind', 'link']);
      const [, , since] = (r.host.link as jasmine.Spy).calls.mostRecent().args;
      expect(since).toBe(r.watches[0]);
    });

    it('stops watching on every way out', async () => {
      // Both sides hold work: the dialog is shown and nothing is switched.
      const asked = rig({ local: something, account: something });
      await asked.connection.connect();
      expect(asked.watches.map((watch) => watch.stop.calls.count())).toEqual([1]);
      // The look at the account fails.
      const failed = rig({ local: something });
      failed.client.syncScope.and.rejectWith(new TypeError('Failed to fetch'));
      await failed.connection.connect();
      expect(failed.watches.map((watch) => watch.stop.calls.count())).toEqual([1]);
      // A download that goes through.
      const downloaded = rig({ local: nothing, account: something });
      await downloaded.connection.connect();
      expect(downloaded.watches.map((watch) => watch.stop.calls.count())).toEqual([1]);
    });

    it('is watched afresh on every automatic retry', async () => {
      const r = rig({ local: nothing, account: something });
      (r.host.link as jasmine.Spy).and.rejectWith(new Error(ERROR_LOCAL_CHANGED));
      await r.connection.connect();
      // The first attempt, its one silent retry, and the fetch that finally asks.
      expect(r.watches.length).toBe(3);
      expect(r.watches.every((watch) => watch.stop.calls.count() === 1)).toBeTrue();
    });
  });

  describe('a failure after the switch committed', () => {
    it('is not an unfinished connection: the device is connected and shows its tasks', async () => {
      const r = rig({ local: nothing, account: something });
      (r.host.link as jasmine.Spy).and.callFake(async () => {
        (r.host as unknown as { linked: () => boolean }).linked = () => true;
        throw new TypeError('Failed to fetch'); // the follow-up listing, after the switch
      });
      await r.connection.connect();
      expect(r.connection.stage()).toBe('idle');
      expect(r.connection.needsRetry()).toBeFalse();
      expect(r.connection.choice()).toBeNull();
      expect(r.host.showWorkspace).toHaveBeenCalledTimes(1);
      expect(r.host.fail).not.toHaveBeenCalled();
    });

    it('is not an unfinished first upload either', async () => {
      const r = rig({ scopes: [] });
      (r.host.link as jasmine.Spy).and.callFake(async () => {
        (r.host as unknown as { linked: () => boolean }).linked = () => true;
        throw new TypeError('Failed to fetch');
      });
      await r.connection.connect();
      expect(r.connection.stage()).toBe('idle');
      expect(r.connection.needsRetry()).toBeFalse();
      expect(r.host.fail).not.toHaveBeenCalled();
    });

    it('still reports a switch that did NOT commit as unfinished', async () => {
      const r = rig({ local: nothing, account: something });
      (r.host.link as jasmine.Spy).and.rejectWith(new TypeError('Failed to fetch'));
      await r.connection.connect();
      expect(r.connection.stage()).toBe('failed');
      expect(r.host.fail).toHaveBeenCalled();
    });
  });

  describe('a device with work and a populated account', () => {
    it('fetches the complete dataset first so that the choice shows real numbers', async () => {
      const order: string[] = [];
      const r = rig({ local: something, account: something });
      (r.host.bind as jasmine.Spy).and.callFake(async () => {
        order.push('bind');
        return false;
      });
      r.client.syncScope.and.callFake(async () => {
        order.push('syncScope');
      });
      await r.connection.connect();
      expect(order).toEqual(['bind', 'syncScope']);
      expect(r.connection.choice()).not.toBeNull();
      expect(r.host.link).not.toHaveBeenCalled();
    });

    it('waits when the dataset turned out to be under another device migration', async () => {
      const r = rig({ local: something, account: something });
      r.client.syncScope.and.callFake(async () => {
        r.client.state.scopes['personal'].info = personal({ state: 'migrating' });
      });
      await r.connection.connect();
      expect(r.connection.stage()).toBe('waiting');
      expect(r.connection.choice()).toBeNull();
      expect(r.host.link).not.toHaveBeenCalled();
    });
  });

  describe('both sides hold real data', () => {
    it('asks immediately, replaces nothing, and shows what each side holds', async () => {
      const local = { ...something, tasks: 2 };
      const r = rig({ local, account: something });
      await r.connection.connect();
      expect(r.host.link).not.toHaveBeenCalled();
      const choice = r.connection.choice()!;
      expect(choice.local).toBe(local);
      expect(choice.account).toBe(something);
      expect(choice.deferred).toBeFalse();
      expect(r.connection.stage()).toBe('idle');
    });

    it('"Download account data" downloads, finishes the connection and shows the tasks', async () => {
      const r = rig({ local: something, account: something });
      await r.connection.connect();
      await r.connection.choose('download');
      expect(r.linkCalls()).toEqual([[false, false]]);
      expect(r.connection.choice()).toBeNull();
      expect(r.host.deferred.write).toHaveBeenCalledWith(false);
      expect(r.host.showWorkspace).toHaveBeenCalled();
    });

    it('"Replace account data with this device" replaces and stays where the person is', async () => {
      const r = rig({ local: something, account: something });
      await r.connection.connect();
      await r.connection.choose('replace');
      expect(r.linkCalls()).toEqual([[true, false]]);
      expect(r.connection.choice()).toBeNull();
      expect(r.host.showWorkspace).not.toHaveBeenCalled();
    });

    it('"Decide later" keeps everything as it was, remembers the deferral, and reads as unfinished', async () => {
      const r = rig({ local: something, account: something });
      await r.connection.connect();
      r.connection.defer();
      expect(r.connection.choice()!.deferred).toBeTrue();
      expect(r.host.deferred.write).toHaveBeenCalledWith(true);
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.host.showWorkspace).not.toHaveBeenCalled();
    });

    it('"Finish connecting" measures again and asks again, even for a deferred choice', async () => {
      const r = rig({ local: something, account: something });
      await r.connection.connect();
      r.connection.defer();
      await r.connection.resume();
      expect(r.client.refreshScopes).toHaveBeenCalledTimes(2);
      expect(r.connection.choice()!.deferred).toBeFalse();
    });

    it('turns an unfinished connection into an automatic download once this device became empty', async () => {
      const r = rig({ local: something, account: something });
      await r.connection.connect();
      r.connection.defer();
      r.setLocal(nothing);
      await r.connection.resume();
      expect(r.linkCalls()).toEqual([[false, true]]);
    });

    it('a restored session does not interrupt with a dialog the person already deferred', async () => {
      const r = rig({ local: something, account: something, deferred: true });
      await r.connection.connect(false);
      expect(r.connection.choice()!.deferred).toBeTrue();
      const fresh = rig({ local: something, account: something, deferred: true });
      await fresh.connection.connect(true);
      expect(fresh.connection.choice()!.deferred).toBeFalse();
    });
  });

  describe('an account with nothing in it', () => {
    it('lets a device with its own data seed it, as the first device does', async () => {
      const r = rig({ local: something, account: nothing });
      await r.connection.connect();
      expect(r.linkCalls()).toEqual([[true, true]]);
      expect(r.host.showWorkspace).not.toHaveBeenCalled();
    });

    it('connects an empty device to an empty account', async () => {
      const r = rig({ local: nothing, account: nothing });
      await r.connection.connect();
      expect(r.linkCalls()).toEqual([[false, true]]);
    });
  });

  describe('the account has no personal dataset yet', () => {
    it('keeps the first device path: its data becomes the account', async () => {
      const r = rig({ scopes: [] });
      await r.connection.connect();
      expect(r.host.serverHasPersonalScope).toHaveBeenCalled();
      expect(r.linkCalls()).toEqual([[true, true]]);
    });

    it('never creates one next to a dataset this client could not verify', async () => {
      const r = rig({ scopes: [] });
      (r.host.serverHasPersonalScope as jasmine.Spy).and.resolveTo(true);
      await r.connection.connect();
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.connection.stage()).toBe('failed');
      expect(r.host.fail).toHaveBeenCalledWith(
        jasmine.objectContaining({ message: 'NATIVE_SYNC.ERROR_DATA' }),
      );
    });

    it('looks again once if another device initialised the account meanwhile', async () => {
      const r = rig({ scopes: [] });
      let first = true;
      r.client.refreshScopes.and.callFake(async () => (first ? [] : [personal()]));
      (r.host.link as jasmine.Spy).and.callFake(async () => {
        if (first) {
          first = false;
          return; // link(true, true) returns without linking: a scope appeared
        }
        (r.host as unknown as { linked: () => boolean }).linked = () => true;
      });
      r.setLocal(nothing);
      await r.connection.connect();
      expect(r.client.refreshScopes).toHaveBeenCalledTimes(2);
      expect(r.linkCalls()[1]).toEqual([false, true]);
    });

    it('resumes an interrupted first upload without creating anything', async () => {
      const r = rig();
      r.client.state.migrations['personal'] = { complete: false };
      await r.connection.connect();
      expect(r.host.serverHasPersonalScope).not.toHaveBeenCalled();
      expect(r.linkCalls()).toEqual([[true, true]]);
    });
  });

  describe('failing to look is not the same as there being nothing', () => {
    it('keeps the device unconnected and ready to retry, creating and replacing nothing', async () => {
      const r = rig();
      r.client.refreshScopes.and.rejectWith(new TypeError('Failed to fetch'));
      await r.connection.connect();
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.host.serverHasPersonalScope).not.toHaveBeenCalled();
      expect(r.connection.stage()).toBe('failed');
      expect(r.connection.needsRetry()).toBeTrue();
      expect(r.connection.choice()).toBeNull();
    });

    it('a partial fetch (the snapshot fails) is also a failure, not an empty account', async () => {
      const r = rig({ local: something });
      r.client.syncScope.and.rejectWith(new TypeError('Failed to fetch'));
      await r.connection.connect();
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.connection.stage()).toBe('failed');
    });

    it('malformed data stops the connection instead of reading as empty', async () => {
      const r = rig({ local: something });
      const broken = new Error('Malformed personal document');
      (
        r.host as unknown as { summary: { fromRecords: () => never } }
      ).summary.fromRecords = () => {
        throw broken;
      };
      await r.connection.connect();
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.host.fail).toHaveBeenCalledWith(broken);
      expect(r.connection.stage()).toBe('failed');
    });

    it('a measurement of this device that throws leaves the connection failed and retryable', async () => {
      const r = rig({ local: something });
      let broken = true;
      (r.host.summary as { local: () => Promise<AccountDataSummary> }).local =
        async () => {
          if (broken) throw new Error('state unreadable');
          return nothing;
        };
      await r.connection.connect();
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.host.bind).not.toHaveBeenCalled();
      expect(r.connection.stage()).toBe('failed');
      expect(r.connection.needsRetry()).toBeTrue();
      broken = false;
      await r.connection.connect(false);
      expect(r.linkCalls()).toEqual([[false, true]]);
    });

    it('retries to completion once the account can be read', async () => {
      const r = rig();
      r.client.refreshScopes.and.rejectWith(new TypeError('Failed to fetch'));
      await r.connection.connect(false);
      r.client.refreshScopes.and.resolveTo([personal()]);
      await r.connection.connect(false);
      expect(r.linkCalls()).toEqual([[false, true]]);
      expect(r.connection.stage()).toBe('idle');
    });

    it('waits for another device that is still setting the account up', async () => {
      const r = rig({ scopes: [personal({ state: 'migrating' })] });
      await r.connection.connect();
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.connection.stage()).toBe('waiting');
      expect(r.connection.needsRetry()).toBeTrue();
    });

    it('a refused session ends the attempt without a retry loop', async () => {
      const r = rig();
      r.client.refreshScopes.and.rejectWith(new Error('401'));
      (r.host.fail as jasmine.Spy).and.returnValue({ sessionLost: true });
      await r.connection.connect();
      expect(r.connection.stage()).toBe('idle');
      expect(r.connection.needsRetry()).toBeFalse();
    });
  });

  describe('when the situation changes during the switch', () => {
    it('refuses to replace when this device changed, and asks again with the reason', async () => {
      const r = rig({ local: something, account: something });
      await r.connection.connect();
      (r.host.link as jasmine.Spy).and.rejectWith(new Error(ERROR_LOCAL_CHANGED));
      await r.connection.choose('download');
      expect(r.connection.choice()).not.toBeNull();
      expect(r.connection.choice()!.deferred).toBeFalse();
      expect(r.connection.notice()).toBe('ACCOUNT_DATA.NOTICE_LOCAL_CHANGED');
      expect(r.connection.stage()).toBe('idle');
      expect(r.host.showWorkspace).not.toHaveBeenCalled();
    });

    it('asks again with fresh numbers when the account changed while choosing', async () => {
      const r = rig({ local: something, account: something });
      await r.connection.connect();
      (r.host.link as jasmine.Spy).and.rejectWith(new Error(ERROR_REMOTE_CHANGED));
      const newer = { ...something, tasks: 9 };
      r.setAccount(newer);
      await r.connection.choose('replace');
      expect(r.connection.choice()!.account).toBe(newer);
      expect(r.connection.notice()).toBe('ACCOUNT_DATA.NOTICE_REMOTE_CHANGED');
    });

    it('an automatic download that meets an edit measures again, and asks if it is real work now', async () => {
      const r = rig({ local: nothing, account: something });
      (r.host.link as jasmine.Spy).and.callFake(async () => {
        // The person typed a task while the download was running.
        r.setLocal({ ...nothing, tasks: 1, hasUserData: true });
        throw new Error(ERROR_LOCAL_CHANGED);
      });
      await r.connection.connect();
      expect(r.connection.choice()).not.toBeNull();
      expect(r.connection.notice()).toBe('ACCOUNT_DATA.NOTICE_LOCAL_CHANGED');
      expect(r.host.showWorkspace).not.toHaveBeenCalled();
    });

    it('an automatic download retries once when edits keep arriving but are no data, then asks', async () => {
      const r = rig({ local: nothing, account: something });
      (r.host.link as jasmine.Spy).and.rejectWith(new Error(ERROR_LOCAL_CHANGED));
      await r.connection.connect();
      // Two automatic attempts, then the person is asked instead of looping.
      expect(r.host.link).toHaveBeenCalledTimes(2);
      expect(r.connection.choice()).not.toBeNull();
      expect(r.connection.notice()).toBe('ACCOUNT_DATA.NOTICE_LOCAL_CHANGED');
    });

    it('a benign edit during an automatic download is absorbed by the retry', async () => {
      const r = rig({ local: nothing, account: something });
      let calls = 0;
      (r.host.link as jasmine.Spy).and.callFake(async () => {
        if (++calls === 1) throw new Error(ERROR_LOCAL_CHANGED); // e.g. a setting changed
        (r.host as unknown as { linked: () => boolean }).linked = () => true;
      });
      await r.connection.connect();
      expect(calls).toBe(2);
      expect(r.connection.choice()).toBeNull();
      expect(r.host.showWorkspace).toHaveBeenCalledTimes(1);
    });

    it('a failed choice (offline, server too old) keeps the choice on screen with the reason', async () => {
      const r = rig({ local: something, account: something });
      await r.connection.connect();
      (r.host.link as jasmine.Spy).and.rejectWith(
        new Error('NATIVE_SYNC.ERROR_REPLACEMENT_UNAVAILABLE'),
      );
      await r.connection.choose('replace');
      expect(r.connection.choice()).not.toBeNull();
      expect(r.connection.notice()).toBe('NATIVE_SYNC.ERROR_REPLACEMENT_UNAVAILABLE');
      expect(r.host.fail).toHaveBeenCalled();
      expect(r.connection.stage()).toBe('idle');
    });
  });

  describe('lifecycle', () => {
    it('reset forgets the choice, the notice and anything still running', async () => {
      const r = rig({ local: something, account: something });
      let release!: () => void;
      r.client.syncScope.and.returnValue(
        new Promise<void>((resolve) => (release = resolve)),
      );
      const running = r.connection.connect();
      r.connection.reset();
      release();
      await running;
      expect(r.connection.choice()).toBeNull();
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.connection.stage()).toBe('idle');
    });

    it('reset while the automatic download runs reports nothing afterwards', async () => {
      const r = rig({ local: nothing, account: something });
      let release!: () => void;
      (r.host.link as jasmine.Spy).and.returnValue(
        new Promise<void>((resolve) => (release = resolve)),
      );
      const running = r.connection.connect();
      // Let the planner reach the download: the engine switch is now pending.
      for (let i = 0; i < 50 && !(r.host.link as jasmine.Spy).calls.count(); i++)
        await Promise.resolve();
      expect(r.host.link).toHaveBeenCalledTimes(1);
      r.connection.reset();
      release();
      await running;
      expect(r.host.showWorkspace).not.toHaveBeenCalled();
      expect(r.connection.stage()).toBe('idle');
    });

    it('a reset while this device is being bound starts no download at all', async () => {
      const r = rig({ local: nothing, account: something });
      let release!: () => void;
      (r.host.bind as jasmine.Spy).and.returnValue(
        new Promise<boolean>((resolve) => (release = () => resolve(false))),
      );
      const running = r.connection.connect();
      for (let i = 0; i < 50 && !(r.host.bind as jasmine.Spy).calls.count(); i++)
        await Promise.resolve();
      expect(r.host.bind).toHaveBeenCalledTimes(1);
      r.connection.reset();
      release();
      await running;
      expect(r.host.link).not.toHaveBeenCalled();
      expect(r.connection.stage()).toBe('idle');
    });

    it('runs one connection at a time', async () => {
      const r = rig({ local: something, account: something });
      const first = r.connection.connect();
      const second = r.connection.connect();
      expect(second).toBe(first);
      await first;
      expect(r.client.refreshScopes).toHaveBeenCalledTimes(1);
    });

    it('does nothing for a device that is already connected', async () => {
      const r = rig();
      (r.host as unknown as { linked: () => boolean }).linked = () => true;
      await r.connection.connect();
      expect(r.client.refreshScopes).not.toHaveBeenCalled();
    });
  });
});
