import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { DateTimeFormatService } from '../../core/date-time-format/date-time-format.service';
import { AccountSyncStatusService } from './account-sync-status.service';
import { AccountSyncTextService } from './account-sync-text.service';
import type { AccountSyncStatus } from './account-sync-status.model';

describe('AccountSyncTextService', () => {
  let service: AccountSyncTextService;
  let status: ReturnType<typeof signal<AccountSyncStatus>>;
  let translate: TranslateService;

  const make = (patch: Partial<AccountSyncStatus> = {}): AccountSyncStatus => ({
    id: 'up-to-date',
    engine: 'account',
    configured: true,
    severity: 'ok',
    busy: false,
    icon: 'sync_done',
    isSvgIcon: true,
    labelKey: 'ACCOUNT_STATUS.UP_TO_DATE',
    detailKey: null,
    reason: null,
    action: 'sync',
    actionLabelKey: null,
    lastSyncedAt: null,
    pendingChanges: 0,
    phase: 'synced',
    ...patch,
  });

  beforeEach(() => {
    status = signal(make());
    TestBed.configureTestingModule({
      imports: [TranslateModule.forRoot()],
      providers: [
        { provide: AccountSyncStatusService, useValue: { status } },
        {
          provide: DateTimeFormatService,
          useValue: {
            formatTime: () => '14:30',
            formatDate: () => '17/11/2026',
          },
        },
      ],
    });
    translate = TestBed.inject(TranslateService);
    translate.setTranslation('en', {
      ACCOUNT_STATUS: {
        UP_TO_DATE: 'Up to date',
        OFFLINE: 'Offline — changes saved on this device',
        LAST_SYNCED: 'Last synced {{when}}',
      },
    });
    translate.use('en');
    service = TestBed.inject(AccountSyncTextService);
  });

  it('is just the label while the last sync is unknown', () => {
    expect(service.lastSynced()).toBeNull();
    expect(service.tooltip()).toBe('Up to date');
  });

  it('adds the time of a sync that happened today', () => {
    status.set(make({ lastSyncedAt: Date.now() }));
    expect(service.lastSyncedWhen()).toBe('14:30');
    expect(service.tooltip()).toBe('Up to date · Last synced 14:30');
  });

  it('adds the date for an older sync', () => {
    status.set(make({ lastSyncedAt: new Date(2026, 10, 17, 14, 30).getTime() }));
    expect(service.lastSyncedWhen()).toBe('17/11/2026 14:30');
  });

  it('keeps saying when it last synced while offline', () => {
    status.set(
      make({
        id: 'offline',
        labelKey: 'ACCOUNT_STATUS.OFFLINE',
        lastSyncedAt: Date.now(),
      }),
    );
    expect(service.tooltip()).toBe(
      'Offline — changes saved on this device · Last synced 14:30',
    );
  });

  it('follows the language', () => {
    translate.setTranslation('de', {
      ACCOUNT_STATUS: {
        UP_TO_DATE: 'Aktuell',
        LAST_SYNCED: 'Zuletzt synchronisiert {{when}}',
      },
    });
    status.set(make({ lastSyncedAt: Date.now() }));
    expect(service.tooltip()).toContain('Up to date');
    translate.use('de');
    expect(service.tooltip()).toBe('Aktuell · Zuletzt synchronisiert 14:30');
  });
});
