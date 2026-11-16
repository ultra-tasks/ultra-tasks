import { fakeAsync, flushMicrotasks, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideStore, Store } from '@ngrx/store';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { IssueProviderActions } from '../../features/issue/store/issue-provider.actions';
import { issueProviderReducer } from '../../features/issue/store/issue-provider.reducer';
import { ISSUE_PROVIDER_DEFAULT_COMMON_CFG } from '../../features/issue/issue.const';
import { PluginService } from '../plugin.service';
import { PluginState } from '../plugin-state.model';
import { pluginMetadataReducer } from '../store/plugin-metadata.reducer';
import { deletePluginMetadata, upsertPluginMetadata } from '../store/plugin.actions';
import { PluginConnectionRuntimeService } from './plugin-connection-runtime.service';

describe('PluginConnectionRuntimeService', () => {
  const id = 'github-issue-provider';
  const state = (): PluginState => ({
    manifest: {
      id,
      name: 'GitHub',
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '0.4.0',
      type: 'issueProvider',
      hooks: [],
      permissions: [],
      issueProvider: {
        issueProviderKey: 'GITHUB',
        pollIntervalMs: 60000,
        icon: 'github',
      },
    },
    type: 'built-in',
    path: 'assets/bundled-plugins/github-issue-provider',
    status: 'not-loaded',
    isEnabled: false,
  });
  const states = signal(new Map<string, PluginState>());
  let store: Store;
  let hydration: HydrationStateService;
  let service: PluginConnectionRuntimeService;
  let activate: jasmine.Spy;
  let unload: jasmine.Spy;

  beforeEach(() => {
    states.set(new Map([[id, state()]]));
    activate = jasmine.createSpy('activatePlugin').and.resolveTo(null);
    unload = jasmine.createSpy('unloadPlugin').and.callFake(() => {
      states.set(new Map([[id, state()]]));
      return true;
    });
    TestBed.configureTestingModule({
      providers: [
        provideStore({
          issueProvider: issueProviderReducer,
          pluginMetadata: pluginMetadataReducer,
        }),
        {
          provide: PluginService,
          useValue: {
            pluginStates: states,
            activatePlugin: activate,
            unloadPlugin: unload,
          },
        },
      ],
    });
    store = TestBed.inject(Store);
    hydration = TestBed.inject(HydrationStateService);
    service = TestBed.inject(PluginConnectionRuntimeService);
    service.start();
    TestBed.tick();
  });

  const receiveConnection = (): void => {
    store.dispatch(
      IssueProviderActions.addIssueProvider({
        issueProvider: {
          ...ISSUE_PROVIDER_DEFAULT_COMMON_CFG,
          id: 'connection',
          issueProviderKey: 'GITHUB',
          pluginId: id,
          pluginConfig: {},
          integrationOwnerId: 'other-installation',
          isEnabled: true,
        },
      }),
    );
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: true } }));
  };

  it('loads an enabled connection received after plugin discovery without emitting a synced action', () => {
    hydration.openSyncWindow();
    receiveConnection();
    TestBed.tick();
    expect(activate).not.toHaveBeenCalled();
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    hydration.closeSyncWindow();
    TestBed.tick();
    expect(activate).toHaveBeenCalledOnceWith(id, true);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('does not activate a connector disabled before replay finishes', () => {
    hydration.openSyncWindow();
    receiveConnection();
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: false } }));
    TestBed.tick();
    hydration.closeSyncWindow();
    TestBed.tick();
    expect(activate).not.toHaveBeenCalled();
  });

  const deferActivation = (): (() => void) => {
    let finish!: () => void;
    activate.and.callFake(() => {
      states.set(new Map([[id, { ...state(), status: 'loading', isEnabled: true }]]));
      return new Promise<null>((resolve) => {
        finish = () => {
          states.set(new Map([[id, { ...state(), status: 'loaded', isEnabled: true }]]));
          resolve(null);
        };
      });
    });
    receiveConnection();
    TestBed.tick();
    expect(activate).toHaveBeenCalledOnceWith(id, true);
    return () => finish();
  };

  for (const disabled of ['plugin', 'connection'] as const) {
    it(`unloads activation completed after its ${disabled} was disabled without another synced action`, fakeAsync(() => {
      const finish = deferActivation();
      if (disabled === 'plugin') {
        store.dispatch(
          upsertPluginMetadata({ pluginMetadata: { id, isEnabled: false } }),
        );
      } else {
        store.dispatch(
          IssueProviderActions.updateIssueProvider({
            issueProvider: { id: 'connection', changes: { isEnabled: false } },
          }),
        );
      }
      TestBed.tick();
      const dispatch = spyOn(store, 'dispatch').and.callThrough();
      finish();
      flushMicrotasks();
      TestBed.tick();
      expect(unload).toHaveBeenCalledOnceWith(id);
      expect(states().get(id)?.isEnabled).toBeFalse();
      expect(dispatch).not.toHaveBeenCalled();
    }));
  }

  it('waits for replay to settle before tearing down an activation disabled during loading', fakeAsync(() => {
    const finish = deferActivation();
    hydration.openSyncWindow();
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: false } }));
    finish();
    flushMicrotasks();
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    hydration.closeSyncWindow();
    TestBed.tick();
    flushMicrotasks();
    TestBed.tick();
    expect(unload).toHaveBeenCalledOnceWith(id);
    expect(dispatch).not.toHaveBeenCalled();
  }));

  it('keeps an activation when replay temporarily disables and then reenables its metadata', fakeAsync(() => {
    const finish = deferActivation();
    hydration.openSyncWindow();
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: false } }));
    finish();
    flushMicrotasks();
    TestBed.tick();
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: true } }));
    hydration.closeSyncWindow();
    TestBed.tick();
    flushMicrotasks();
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
    expect(states().get(id)?.isEnabled).toBeTrue();
    expect(activate).toHaveBeenCalledTimes(1);
  }));

  it('unloads an already activated connector after an explicit metadata disable without another synced action', fakeAsync(() => {
    const finish = deferActivation();
    finish();
    flushMicrotasks();
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: false } }));
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    TestBed.tick();
    expect(unload).toHaveBeenCalledOnceWith(id);
    expect(states().get(id)?.isEnabled).toBeFalse();
    expect(dispatch).not.toHaveBeenCalled();
  }));

  it('keeps an already activated connector when metadata is absent', fakeAsync(() => {
    const finish = deferActivation();
    finish();
    flushMicrotasks();
    TestBed.tick();
    store.dispatch(deletePluginMetadata({ pluginId: id }));
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
    expect(states().get(id)?.isEnabled).toBeTrue();
  }));

  it('does not unload uploaded or native-execution runtimes after metadata disables', () => {
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: false } }));
    const uploaded: PluginState = {
      ...state(),
      type: 'uploaded',
      status: 'loaded',
      isEnabled: true,
    };
    states.set(new Map([[id, uploaded]]));
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
    const native: PluginState = { ...state(), status: 'loaded', isEnabled: true };
    native.manifest.permissions = ['nodeExecution'];
    states.set(new Map([[id, native]]));
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
  });

  it('defers a loaded connector disable until replay settles and ignores transient disables', fakeAsync(() => {
    const finish = deferActivation();
    finish();
    flushMicrotasks();
    TestBed.tick();
    hydration.openSyncWindow();
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: false } }));
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: true } }));
    hydration.closeSyncWindow();
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
    hydration.openSyncWindow();
    store.dispatch(upsertPluginMetadata({ pluginMetadata: { id, isEnabled: false } }));
    TestBed.tick();
    expect(unload).not.toHaveBeenCalled();
    hydration.closeSyncWindow();
    const dispatch = spyOn(store, 'dispatch').and.callThrough();
    TestBed.tick();
    expect(unload).toHaveBeenCalledOnceWith(id);
    expect(dispatch).not.toHaveBeenCalled();
  }));

  it('rechecks discovery without enabling uploaded code or native execution', () => {
    states.set(new Map());
    receiveConnection();
    TestBed.tick();
    expect(activate).not.toHaveBeenCalled();
    states.set(new Map([[id, { ...state(), type: 'uploaded' }]]));
    TestBed.tick();
    expect(activate).not.toHaveBeenCalled();
    const native = state();
    native.manifest.permissions = ['nodeExecution'];
    states.set(new Map([[id, native]]));
    TestBed.tick();
    expect(activate).not.toHaveBeenCalled();
    states.set(new Map([[id, state()]]));
    TestBed.tick();
    expect(activate).toHaveBeenCalledOnceWith(id, true);
  });
});
