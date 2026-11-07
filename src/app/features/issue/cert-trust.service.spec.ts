import { TestBed } from '@angular/core/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { CertTrustService } from './cert-trust.service';
import { selectEnabledIssueProviders } from './store/issue-provider.selectors';
import { SyncProviderManager } from '../../op-log/sync-providers/provider-manager.service';
import { CurrentProviderPrivateCfg } from '../../op-log/core/types/sync.types';
import { SUPER_SYNC_DEFAULT_BASE_URL } from '@sp/sync-providers/super-sync';

describe('CertTrustService', () => {
  let store: MockStore;
  let privateCfg$: BehaviorSubject<CurrentProviderPrivateCfg | null>;
  let emitted: string[][];

  beforeEach(() => {
    privateCfg$ = new BehaviorSubject<CurrentProviderPrivateCfg | null>(null);
    TestBed.configureTestingModule({
      providers: [
        provideMockStore({
          selectors: [{ selector: selectEnabledIssueProviders, value: [] }],
        }),
        {
          provide: SyncProviderManager,
          useValue: { currentProviderPrivateCfg$: privateCfg$ },
        },
      ],
    });
    store = TestBed.inject(MockStore);
    emitted = [];
    TestBed.inject(CertTrustService).trustedHosts$.subscribe((h) => emitted.push(h));
  });

  it('combines enabled issue provider and active sync provider hosts', () => {
    store.overrideSelector(selectEnabledIssueProviders, [
      { id: 'a', host: 'https://jira.corp.local' },
      { id: 'b', pluginConfig: { url: 'https://gitea.lan:3000' } },
    ] as never);
    store.refreshState();
    privateCfg$.next({
      providerId: 'WebDAV',
      privateCfg: { baseUrl: 'https://nas.lan/dav', userName: 'u' },
    } as never);

    expect(emitted.at(-1)).toEqual(['gitea.lan:3000', 'jira.corp.local', 'nas.lan']);
  });

  it('does not trust the default SuperSync server', () => {
    privateCfg$.next({
      providerId: 'SuperSync',
      privateCfg: { baseUrl: SUPER_SYNC_DEFAULT_BASE_URL },
    } as never);

    expect(emitted).toEqual([[]]);
  });

  it('does not trust the default Plainspace server', () => {
    store.overrideSelector(selectEnabledIssueProviders, [
      { id: 'p', host: 'https://plainspace.org' },
    ] as never);
    store.refreshState();

    expect(emitted.at(-1)).toEqual([]);
  });

  it('allows custom sync servers, including the local development server', () => {
    for (const baseUrl of ['https://sync.my-server.lan:8443', 'http://localhost:1901']) {
      privateCfg$.next({ providerId: 'SuperSync', privateCfg: { baseUrl } } as never);
      expect(emitted.at(-1)).toEqual([new URL(baseUrl).host]);
    }
  });

  it('removes disabled issue providers and inactive sync hosts', () => {
    store.overrideSelector(selectEnabledIssueProviders, [
      { id: 'a', host: 'https://jira.lan' },
    ] as never);
    store.refreshState();
    privateCfg$.next({
      providerId: 'Nextcloud',
      privateCfg: { serverUrl: 'https://cloud.lan' },
    } as never);
    expect(emitted.at(-1)).toEqual(['cloud.lan', 'jira.lan']);
    store.overrideSelector(selectEnabledIssueProviders, []);
    store.refreshState();
    expect(emitted.at(-1)).toEqual(['cloud.lan']);
    privateCfg$.next(null);
    expect(emitted.at(-1)).toEqual([]);
  });

  it('does not grant trust to URL-shaped credentials or alternative link hosts', () => {
    store.overrideSelector(selectEnabledIssueProviders, [
      {
        id: 'a',
        host: 'https://jira.lan',
        token: 'https://secret.example',
        altPublicLinkHost: 'https://links.example',
      },
    ] as never);
    store.refreshState();
    expect(emitted.at(-1)).toEqual(['jira.lan']);
  });

  it('emits only when the host list changes', () => {
    privateCfg$.next({
      providerId: 'WebDAV',
      privateCfg: { baseUrl: 'https://nas.lan/a' },
    } as never);
    privateCfg$.next({
      providerId: 'WebDAV',
      privateCfg: { baseUrl: 'https://nas.lan/b' },
    } as never);

    expect(emitted).toEqual([[], ['nas.lan']]);
  });
});
