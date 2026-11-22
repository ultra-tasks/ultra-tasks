import { LiveAnnouncer } from '@angular/cdk/a11y';
import { ComponentFixture, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { AccountSyncActionsService } from '../account-sync-actions.service';
import { AccountSyncStatusService } from '../account-sync-status.service';
import { AccountSyncTextService } from '../account-sync-text.service';
import {
  isAttentionStatus,
  type AccountStatusAction,
  type AccountStatusId,
  type AccountSyncStatus,
} from '../account-sync-status.model';
import { NativeSyncService } from '../native-sync.service';
import { AccountSyncSummaryComponent } from './account-sync-summary.component';

describe('AccountSyncSummaryComponent', () => {
  let fixture: ComponentFixture<AccountSyncSummaryComponent>;
  let status: ReturnType<typeof signal<AccountSyncStatus>>;
  let lastSynced: ReturnType<typeof signal<string | null>>;
  let identity: ReturnType<typeof signal<{ email: string; id: string } | null>>;
  let actions: jasmine.SpyObj<AccountSyncActionsService>;
  let announcer: jasmine.SpyObj<LiveAnnouncer>;

  const make = (
    id: AccountStatusId,
    patch: Partial<AccountSyncStatus> = {},
  ): AccountSyncStatus => ({
    id,
    engine: 'account',
    configured: true,
    severity: 'ok',
    busy: false,
    icon: 'sync_done',
    isSvgIcon: true,
    labelKey: `LABEL.${id}`,
    detailKey: null,
    reason: null,
    action: 'sync',
    actionLabelKey: T.ACCOUNT_STATUS.ACTION_SYNC,
    lastSyncedAt: null,
    pendingChanges: 0,
    phase: null,
    ...patch,
  });
  const attention = (
    id: AccountStatusId,
    action: AccountStatusAction,
    labelKey: string,
  ): AccountSyncStatus =>
    make(id, {
      severity: 'warning',
      icon: 'lock',
      isSvgIcon: false,
      action,
      actionLabelKey: labelKey,
    });

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const text = (): string => (el().textContent ?? '').replace(/\s+/g, ' ').trim();
  const buttons = (): HTMLButtonElement[] =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('button'));
  const buttonByText = (label: string): HTMLButtonElement | undefined =>
    buttons().find((b) => (b.textContent ?? '').includes(label));
  const render = (): void => fixture.detectChanges();

  beforeEach(async () => {
    status = signal(make('up-to-date'));
    lastSynced = signal<string | null>(null);
    identity = signal<{ email: string; id: string } | null>({
      email: 'synthetic@example.test',
      id: '11111111-2222-3333-4444-555555555555',
    });
    actions = jasmine.createSpyObj('AccountSyncActionsService', [
      'run',
      'syncNow',
      'openAccount',
      'copyAccountId',
    ]);
    actions.run.and.resolveTo();
    actions.syncNow.and.resolveTo();
    actions.openAccount.and.resolveTo();
    actions.copyAccountId.and.resolveTo(true);
    announcer = jasmine.createSpyObj('LiveAnnouncer', ['announce']);
    announcer.announce.and.resolveTo();

    await TestBed.configureTestingModule({
      imports: [AccountSyncSummaryComponent, TranslateModule.forRoot()],
      providers: [
        provideNoopAnimations(),
        { provide: LiveAnnouncer, useValue: announcer },
        {
          provide: AccountSyncStatusService,
          useValue: { status, syncSource: signal('sync.example.test') },
        },
        { provide: NativeSyncService, useValue: { accountIdentity: identity } },
        { provide: AccountSyncTextService, useValue: { lastSynced } },
        { provide: AccountSyncActionsService, useValue: actions },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AccountSyncSummaryComponent);
  });

  describe('a connected account', () => {
    it('shows who it is, its status and the Account ID, as one summary', () => {
      lastSynced.set('Last synced 14:30');
      render();

      expect(text()).toContain('LABEL.up-to-date');
      expect(text()).toContain('Last synced 14:30');
      expect(text()).toContain(T.ACCOUNT_STATUS.EMAIL);
      expect(text()).toContain('synthetic@example.test');
      expect(text()).toContain(T.ACCOUNT_STATUS.ACCOUNT_ID);
      expect(el().querySelector('code.ass__id')?.textContent).toBe(
        '11111111-2222-3333-4444-555555555555',
      );
    });

    it('explains that the Account ID is not a password and proves no ownership', () => {
      render();
      expect(text()).toContain(T.ACCOUNT_STATUS.ACCOUNT_ID_HINT);
      // The copy button is described by that hint.
      const copy = el().querySelector<HTMLButtonElement>('.ass__copy')!;
      const hint = el().querySelector('.ass__hint')!;
      expect(copy.getAttribute('aria-describedby')).toBe(hint.id);
      expect(copy.getAttribute('aria-label')).toBe(T.ACCOUNT_STATUS.COPY_ACCOUNT_ID);
    });

    it('syncs now as the primary action and opens the account as the secondary one', () => {
      render();
      buttonByText(T.ACCOUNT_STATUS.ACTION_SYNC)!.click();
      expect(actions.run).toHaveBeenCalledOnceWith(status());
      buttonByText(T.ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT)!.click();
      expect(actions.openAccount).toHaveBeenCalledTimes(1);
    });

    it('keeps the other sync options collapsed, with the provider dialog entry inside', () => {
      render();
      const details = el().querySelector<HTMLDetailsElement>('details.ass__other')!;
      expect(details.open).toBeFalse();
      expect(details.querySelector('summary')?.textContent).toContain(
        T.ACCOUNT_STATUS.OTHER_OPTIONS,
      );
      const requested = jasmine.createSpy('requested');
      fixture.componentInstance.setupRequested.subscribe(requested);
      details.querySelector<HTMLButtonElement>('button')!.click();
      expect(requested).toHaveBeenCalledTimes(1);
    });

    it('can leave the other options out, for the dialog that is itself that choice', () => {
      fixture.componentRef.setInput('showOtherOptions', false);
      render();
      expect(el().querySelector('details')).toBeNull();
    });

    it('shows the primary action as outlined in a dialog that has its own primary action', () => {
      render();
      const filled = buttonByText(T.ACCOUNT_STATUS.ACTION_SYNC)!;
      expect(filled.classList).toContain('mat-mdc-unelevated-button');
      fixture.componentRef.setInput('compact', true);
      render();
      expect(buttonByText(T.ACCOUNT_STATUS.ACTION_SYNC)!.classList).toContain(
        'mat-mdc-outlined-button',
      );
    });

    it('disables the primary action while work is running, and still names it', () => {
      status.set(make('downloading', { busy: true, action: null, actionLabelKey: null }));
      render();
      const primary = buttonByText(T.ACCOUNT_STATUS.ACTION_SYNC)!;
      expect(primary.disabled).toBeTrue();
    });

    it('lists the changes that are waiting while offline', () => {
      status.set(make('offline', { pendingChanges: 3, severity: 'warning' }));
      render();
      expect(text()).toContain(T.ACCOUNT_STATUS.PENDING_CHANGES);
    });

    it('shows the reason of a failure next to its label', () => {
      status.set(
        make('error', {
          severity: 'error',
          action: 'retry',
          actionLabelKey: T.ACCOUNT_STATUS.ACTION_RETRY,
          reason: 'NATIVE_SYNC.ERROR_SYNC',
        }),
      );
      render();
      expect(text()).toContain('LABEL.error');
      expect(text()).toContain('NATIVE_SYNC.ERROR_SYNC');
      expect(buttonByText(T.ACCOUNT_STATUS.ACTION_RETRY)).toBeTruthy();
    });
  });

  describe('a connected account that needs the user', () => {
    const cases: [string, AccountSyncStatus, string][] = [
      ['locked', attention('locked', 'unlock', T.ACCOUNT_STATUS.ACTION_UNLOCK), 'Unlock'],
      [
        'reauth',
        attention('reauth', 'sign-in', T.ACCOUNT_STATUS.ACTION_SIGN_IN),
        'Sign in',
      ],
      [
        'choose-data',
        attention('choose-data', 'choose-data', T.ACCOUNT_STATUS.ACTION_CHOOSE_DATA),
        'Finish connecting',
      ],
    ];

    for (const [name, value] of cases) {
      it(`never offers "Set up sync" while ${name}, and keeps the identity`, () => {
        status.set(value);
        render();
        expect(text()).not.toContain(T.ACCOUNT_STATUS.ACTION_SETUP);
        expect(text()).toContain('synthetic@example.test');
        expect(isAttentionStatus(value)).toBeTrue();
      });
    }

    it('runs the status action from its button: unlock, sign in or finish connecting', () => {
      for (const [, value] of cases) {
        status.set(value);
        render();
        buttonByText(value.actionLabelKey!)!.click();
        expect(actions.run).toHaveBeenCalledWith(value);
      }
    });

    it('has no second "open account" button when the primary one already goes there', () => {
      status.set(cases[0][1]);
      render();
      expect(buttonByText(T.ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT)).toBeUndefined();
    });

    it('keeps the account page one click away while the data connection is unfinished', () => {
      status.set(cases[2][1]);
      render();
      expect(buttonByText(T.ACCOUNT_STATUS.ACTION_OPEN_ACCOUNT)).toBeTruthy();
    });
  });

  describe('copying the Account ID', () => {
    it('says "Copied" politely through the shared live region, and shows it in place', fakeAsync(() => {
      render();
      const icon = (): string =>
        el().querySelector('.ass__copy mat-icon')!.textContent!.trim();
      expect(icon()).toBe('content_copy');
      expect(announcer.announce).not.toHaveBeenCalled();

      el().querySelector<HTMLButtonElement>('.ass__copy')!.click();
      tick();
      render();
      expect(actions.copyAccountId).toHaveBeenCalledOnceWith(
        '11111111-2222-3333-4444-555555555555',
      );
      expect(announcer.announce).toHaveBeenCalledOnceWith(
        T.ACCOUNT_STATUS.COPIED,
        'polite',
      );
      // The button answers in place too: its icon turns into a check for a moment.
      expect(icon()).toBe('check');

      tick(2000);
      render();
      expect(icon()).toBe('content_copy');
    }));

    it('says nothing when the copy failed', fakeAsync(() => {
      actions.copyAccountId.and.resolveTo(false);
      render();
      el().querySelector<HTMLButtonElement>('.ass__copy')!.click();
      tick();
      render();
      expect(announcer.announce).not.toHaveBeenCalled();
      expect(el().querySelector('.ass__copy mat-icon')!.textContent!.trim()).toBe(
        'content_copy',
      );
    }));

    it('adds no live region of its own, so a host dialog keeps the only status region', () => {
      // The provider dialog's saving state is a role="status" that an E2E reads on its own.
      render();
      expect(el().querySelector('[role="status"], [aria-live]')).toBeNull();
    });
  });

  describe('a legacy provider', () => {
    beforeEach(() => {
      status.set(make('up-to-date', { engine: 'provider', action: null }));
      fixture.componentRef.setInput('provider', {
        providerId: 'WebDAV',
        needsAuth: true,
        isEncrypted: true,
      });
    });

    it('keeps its provider summary, with the pills', () => {
      render();
      expect(text()).toContain('WebDAV');
      expect(text()).toContain(T.PS.SYNC.NEEDS_AUTH);
      expect(text()).toContain(T.PS.SYNC.ENCRYPTED);
      expect(el().querySelector('.ass__identity')).toBeNull();
      expect(el().querySelector('details')).toBeNull();
    });

    it('syncs the provider and opens its dialog from Configure', () => {
      render();
      const requested = jasmine.createSpy('requested');
      fixture.componentRef.setInput('compact', false);
      fixture.componentInstance.setupRequested.subscribe(requested);
      buttonByText(T.ACCOUNT_STATUS.ACTION_SYNC)!.click();
      expect(actions.syncNow).toHaveBeenCalledTimes(1);
      buttonByText(T.PS.SYNC.CONFIGURE)!.click();
      expect(requested).toHaveBeenCalledTimes(1);
    });
  });

  describe('nothing configured', () => {
    beforeEach(() => {
      status.set(
        make('local-only', {
          engine: null,
          configured: false,
          severity: 'neutral',
          icon: 'sync_off',
          action: 'setup',
          actionLabelKey: T.ACCOUNT_STATUS.ACTION_SETUP,
          detailKey: T.ACCOUNT_STATUS.LOCAL_ONLY_DETAIL,
        }),
      );
      identity.set(null);
    });

    it('says local only and offers to set up sync in the provider dialog', () => {
      render();
      expect(text()).toContain('LABEL.local-only');
      expect(text()).toContain(T.ACCOUNT_STATUS.LOCAL_ONLY_DETAIL);
      const requested = jasmine.createSpy('requested');
      fixture.componentInstance.setupRequested.subscribe(requested);
      buttonByText(T.ACCOUNT_STATUS.ACTION_SETUP)!.click();
      expect(requested).toHaveBeenCalledTimes(1);
      // Exactly one such button: it is how a first-run page finds it.
      expect(
        buttons().filter((b) =>
          (b.textContent ?? '').includes(T.ACCOUNT_STATUS.ACTION_SETUP),
        ).length,
      ).toBe(1);
    });
  });
});
