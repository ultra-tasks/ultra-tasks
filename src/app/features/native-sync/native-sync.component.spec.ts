import { signal } from '@angular/core';
import {
  ComponentFixture,
  TestBed,
  discardPeriodicTasks,
  fakeAsync,
  flushMicrotasks,
  tick,
} from '@angular/core/testing';
import { MatIconTestingModule } from '@angular/material/icon/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import {
  TranslateLoader,
  TranslateModule,
  TranslateService,
  TranslationObject,
} from '@ngx-translate/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { NativeSyncComponent } from './native-sync.component';
import { NativeSyncService } from './native-sync.service';
import { NativeAccountLoginService } from './native-account-login.service';
import type {
  AccountDataChoice,
  AccountPhase,
  DeviceVerificationView,
} from './account-sync.types';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import { SyncWrapperService } from '../../imex/sync/sync-wrapper.service';
import { DateService } from '../../core/date/date.service';
import { ShareService } from '../../core/share/share.service';
import { getAllEnv } from '../../util/env';
import { environment as appEnvironment } from '../../../environments/environment';
import { CalendarPublicationService } from '../integrations/calendar-publication.service';
import { ProjectService } from '../project/project.service';
import { TagService } from '../tag/tag.service';
import enTranslations from '../../../assets/i18n/en.json';

class JsonTranslateLoader implements TranslateLoader {
  getTranslation(): Observable<TranslationObject> {
    return of(enTranslations as TranslationObject);
  }
}

const OFFICIAL = 'https://accounts.example.test';
const CUSTOM = 'https://self-host.example.test';
const ACCOUNT_ID = '5b0a0b8e-3a52-4d3e-9f4c-0d9e6b0f9a11';
const FIVE_MINUTES = 300_000;

// The literal is the type: spelling out every signal again would only restate it.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const createNative = () => ({
  configured: signal(false),
  unlocked: signal(false),
  linked: signal(false),
  busy: signal(false),
  error: signal(''),
  backgroundError: signal(''),
  phase: signal<AccountPhase>('signed-out'),
  offline: signal(false),
  emptyAccount: signal(false),
  lastSyncedAt: signal<number | null>(null),
  lockReason: signal<'storage-unavailable' | null>(null),
  pendingChanges: signal(0),
  dataChoice: signal<AccountDataChoice | null>(null),
  canRecoverPersonal: signal(false),
  abandonedPersonalSetup:
    signal<ReturnType<NativeSyncService['abandonedPersonalSetup']>>(undefined),
  deviceVerification: signal<DeviceVerificationView | null>(null),
  accountIdentity: signal<{ email: string; id: string } | null>(null),
  mfaMethods: signal<string[]>([]),
  status: signal('NATIVE_SYNC.LOCKED'),
  live: signal(false),
  personalRealtimeEnabled: signal(false),
  sharingEnabled: signal(false),
  projects: signal([]),
  scopes: signal([]),
  invitations: signal([]),
  ownershipOffers: signal([]),
  revision: signal(0),
  serverUrl: OFFICIAL,
  login: jasmine.createSpy('login').and.resolveTo(true),
  lock: jasmine.createSpy('lock').and.resolveTo(),
  logout: jasmine.createSpy('logout').and.resolveTo(),
  disconnect: jasmine.createSpy('disconnect').and.resolveTo(),
  syncNow: jasmine.createSpy('syncNow').and.resolveTo(),
  openAccount: jasmine.createSpy('openAccount').and.resolveTo(),
  resumeDataConnection: jasmine.createSpy('resumeDataConnection').and.resolveTo(),
  recoverPersonalSync: jasmine.createSpy('recoverPersonalSync').and.resolveTo(),
  recoverAbandonedPersonalSetup: jasmine
    .createSpy('recoverAbandonedPersonalSetup')
    .and.resolveTo(),
  completeMfa: jasmine.createSpy('completeMfa').and.resolveTo(),
  completeDeviceVerification: jasmine
    .createSpy('completeDeviceVerification')
    .and.resolveTo(),
  resendDeviceVerification: jasmine.createSpy('resendDeviceVerification').and.resolveTo(),
  cancelDeviceVerification: jasmine.createSpy('cancelDeviceVerification').and.resolveTo(),
  passkey: jasmine.createSpy('passkey').and.resolveTo(),
  deleteAccount: jasmine.createSpy('deleteAccount').and.resolveTo(),
});

describe('NativeSyncComponent', () => {
  const environment = getAllEnv() as Record<string, string | undefined>;
  let previousOfficial: string | undefined;
  let previousServer: string | null;

  // A stand-in with the same signals as NativeSyncService: the page reads them, the real
  // AccountSyncStatusService derives the status from them, and nothing is faked beyond that.
  let native: ReturnType<typeof createNative>;
  let accountLogin: {
    active: ReturnType<typeof signal<boolean>>;
    completing: ReturnType<typeof signal<boolean>>;
    code: ReturnType<typeof signal<string>>;
    server: ReturnType<typeof signal<string>>;
    error: ReturnType<typeof signal<string>>;
    start: jasmine.Spy;
    cancel: jasmine.Spy;
    open: jasmine.Spy;
  };
  let router: { navigateByUrl: jasmine.Spy };
  let share: { copyToClipboard: jasmine.Spy };
  let fixture: ComponentFixture<NativeSyncComponent>;

  const configure = async (): Promise<void> => {
    native = createNative();
    accountLogin = {
      active: signal(false),
      completing: signal(false),
      code: signal(''),
      server: signal(''),
      error: signal(''),
      start: jasmine.createSpy('start').and.resolveTo(),
      cancel: jasmine.createSpy('cancel').and.resolveTo(),
      open: jasmine.createSpy('open').and.resolveTo(),
    };
    router = { navigateByUrl: jasmine.createSpy('navigateByUrl').and.resolveTo(true) };
    share = {
      copyToClipboard: jasmine
        .createSpy('copyToClipboard')
        .and.resolveTo({ success: true }),
    };
    await TestBed.configureTestingModule({
      imports: [
        NativeSyncComponent,
        NoopAnimationsModule,
        MatIconTestingModule,
        TranslateModule.forRoot({
          loader: { provide: TranslateLoader, useClass: JsonTranslateLoader },
        }),
      ],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: { queryParamMap: of(convertToParamMap({})) },
        },
        { provide: Router, useValue: router },
        { provide: MatDialog, useValue: {} },
        { provide: Store, useValue: { selectSignal: () => signal([]) } },
        { provide: NativeSyncService, useValue: native },
        { provide: NativeAccountLoginService, useValue: accountLogin },
        { provide: StateSnapshotService, useValue: {} },
        { provide: DateService, useValue: {} },
        { provide: ShareService, useValue: share },
        {
          provide: SyncWrapperService,
          useValue: {
            syncCfg$: new BehaviorSubject({ isEnabled: false, syncProvider: null }),
            isEnabledAndReady$: new BehaviorSubject(false),
            syncState$: new BehaviorSubject('UNKNOWN_OR_CHANGED'),
            isSyncInProgress$: new BehaviorSubject(false),
            hasNoPendingOps$: new BehaviorSubject(true),
          },
        },
        {
          provide: CalendarPublicationService,
          useValue: {
            available: signal(true),
            feeds: signal([]),
            busy: signal(false),
            error: signal(false),
            ownedIds: signal(new Set<string>()),
            refresh: jasmine.createSpy('refresh'),
          },
        },
        { provide: ProjectService, useValue: { list: signal([]) } },
        { provide: TagService, useValue: { tagsNoMyDayAndNoList: signal([]) } },
      ],
    }).compileComponents();
    TestBed.inject(TranslateService).use('en');
  };

  const render = async (): Promise<HTMLElement> => {
    fixture = TestBed.createComponent(NativeSyncComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };
  const settle = async (): Promise<void> => {
    // Handlers chain several promises: yield a macrotask so they finish before we look.
    for (let i = 0; i < 3; i++) {
      fixture.detectChanges();
      await fixture.whenStable();
      await new Promise<void>((resolve) => setTimeout(resolve));
    }
    fixture.detectChanges();
  };
  const el = <T extends HTMLElement = HTMLElement>(selector: string): T | null =>
    (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  /** The label of a Material button, without its icon ligature. */
  const ownText = (b: HTMLElement): string =>
    (b.querySelector('.mdc-button__label') ?? b).textContent?.trim() ?? '';
  const button = (label: string): HTMLButtonElement | undefined =>
    Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        'button',
      ),
    ).find((b) => ownText(b) === label);
  /** Picks a server through the radio, the way a click does (the page is OnPush). */
  const chooseServer = async (
    label: 'Official server' | 'Custom server',
  ): Promise<void> => {
    const radio = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('mat-radio-button'),
    ).find((r) => (r.textContent ?? '').trim() === label)!;
    radio.querySelector<HTMLInputElement>('input[type="radio"]')!.click();
    await settle();
  };
  const type = async (selector: string, value: string): Promise<void> => {
    const input = el<HTMLInputElement>(selector)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  };
  const signIn = (): void => {
    native.unlocked.set(true);
    native.configured.set(true);
    native.linked.set(true);
    native.phase.set('synced');
    native.accountIdentity.set({ email: 'ada@example.test', id: ACCOUNT_ID });
  };

  beforeEach(() => {
    previousOfficial = environment['ULTRA_ACCOUNT_URL'];
    previousServer = localStorage.getItem('ultra-native-server');
    environment['ULTRA_ACCOUNT_URL'] = OFFICIAL;
    localStorage.removeItem('ultra-native-server');
  });
  afterEach(() => {
    if (previousOfficial === undefined) delete environment['ULTRA_ACCOUNT_URL'];
    else environment['ULTRA_ACCOUNT_URL'] = previousOfficial;
    if (previousServer === null) localStorage.removeItem('ultra-native-server');
    else localStorage.setItem('ultra-native-server', previousServer);
  });

  describe('conflict draft dismissal', () => {
    for (const accepted of [false, true]) {
      it(`only dismisses all conflict drafts after confirmation (${accepted})`, async () => {
        await configure();
        await render();
        const dismissDrafts = jasmine.createSpy().and.resolveTo();
        Object.assign(native, {
          client: {
            state: { scopes: { personal: { info: { id: 'personal' } } } },
            dismissDrafts,
          },
        });
        spyOn(fixture.componentInstance, 'hasConflictDrafts').and.returnValue(true);
        const open = jasmine
          .createSpy()
          .and.returnValue({ afterClosed: () => of(accepted) });
        TestBed.inject(MatDialog).open = open;
        await fixture.componentInstance.dismissDrafts();
        expect(open).toHaveBeenCalledWith(jasmine.any(Function), {
          data: { message: 'NATIVE_SYNC.DISMISS_DRAFTS_CONFIRM' },
        });
        if (accepted) expect(dismissDrafts).toHaveBeenCalledOnceWith('personal');
        else expect(dismissDrafts).not.toHaveBeenCalled();
      });
    }
  });

  describe('server selection', () => {
    beforeEach(configure);
    const create = (): NativeSyncComponent =>
      TestBed.runInInjectionContext(() => new NativeSyncComponent());

    it('defaults new sign-in to the configured official server', () => {
      const component = create();
      expect(component.serverMode).toBe('official');
      expect(component.server).toBe(OFFICIAL);
    });
    it('uses the deployed official origin in production without a build override', () => {
      const build = appEnvironment as { production: boolean };
      const previousProduction = build.production;
      try {
        build.production = true;
        delete environment['ULTRA_ACCOUNT_URL'];
        const component = create();
        expect(component.serverMode).toBe('official');
        expect(component.server).toBe('https://app.ultratasks.app');
      } finally {
        build.production = previousProduction;
      }
    });
    it('preserves an existing self-hosted endpoint', () => {
      localStorage.setItem('ultra-native-server', CUSTOM);
      const component = create();
      expect(component.serverMode).toBe('custom');
      expect(component.server).toBe(CUSTOM);
    });
    it('keeps a custom endpoint when switching back and forth', () => {
      const component = create();
      component.selectServerMode('custom');
      component.customServer = CUSTOM;
      component.selectServerMode('official');
      expect(component.server).toBe(OFFICIAL);
      component.selectServerMode('custom');
      expect(component.server).toBe(CUSTOM);
    });
    it('supports custom-only builds without inventing an official origin', () => {
      delete environment['ULTRA_ACCOUNT_URL'];
      const component = create();
      expect(component.serverMode).toBe('custom');
      expect(component.server).toBe('');
    });
  });

  describe('signed out', () => {
    beforeEach(configure);

    it('names the page by what it does and offers one primary action', async () => {
      await render();
      expect(el('h2')!.textContent).toContain('Sign in to your Ultra Tasks account');
      const primary = button('Sign in')!;
      expect(primary.getAttribute('type')).toBe('submit');
      expect(button('Sign in with browser')).toBeDefined();
      expect(text()).toContain('Sync your tasks across all your devices, privately.');
      expect(text()).toContain(
        'End-to-end encrypted. Your password and vault keys stay on this device.',
      );
      expect(text()).not.toContain('Sign in and unlock');
      expect(text()).not.toContain('Email or username');
    });

    it('hides the server address for the official server and says where it signs in', async () => {
      await render();
      expect(el('input[name="server"]')).toBeNull();
      expect(text()).toContain('Signing in to accounts.example.test');
      expect(
        Array.from(fixture.nativeElement.querySelectorAll('input[readonly]')),
      ).toEqual([]);
      const radios = fixture.nativeElement.querySelectorAll('mat-radio-button');
      expect(
        Array.from(radios).map((r) => (r as HTMLElement).textContent?.trim()),
      ).toEqual(['Official server', 'Custom server']);
    });

    it('reveals the address field only for a custom server and keeps the draft', async () => {
      await render();
      await chooseServer('Custom server');
      expect(el('input[name="server"]')).not.toBeNull();
      await type('input[name="server"]', CUSTOM);
      await chooseServer('Official server');
      expect(el('input[name="server"]')).toBeNull();
      await chooseServer('Custom server');
      expect(el<HTMLInputElement>('input[name="server"]')!.value).toBe(CUSTOM);
    });

    it('shows the address field when the build has no official server', async () => {
      delete environment['ULTRA_ACCOUNT_URL'];
      await render();
      expect(el('mat-radio-group')).toBeNull();
      expect(el('input[name="server"]')).not.toBeNull();
    });

    it('validates the selected origin inline, before anything is sent', async () => {
      await render();
      await chooseServer('Custom server');
      await type('input[name="server"]', 'http://remote.example.test');
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'a long test password');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(native.login).not.toHaveBeenCalled();
      const alerts = fixture.nativeElement.querySelectorAll('[role="alert"]');
      expect(alerts.length).toBe(1);
      expect(alerts[0].textContent).toContain('Use an HTTPS server URL');
      expect(alerts[0].closest('mat-form-field')).not.toBeNull();
      // Typing again clears the complaint.
      await type('input[name="server"]', 'https://');
      expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(0);
    });

    it('asks for an address when a custom server is chosen but left empty', async () => {
      await render();
      await chooseServer('Custom server');
      await type('input[name="identifier"]', 'ada@example.test');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(native.login).not.toHaveBeenCalled();
      expect(text()).toContain('Enter your server address.');
    });

    it('accepts plain HTTP only for localhost development', async () => {
      await render();
      await chooseServer('Custom server');
      await type('input[name="server"]', 'http://localhost:1900');
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'a long test password');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(native.login).toHaveBeenCalledWith(
        'http://localhost:1900',
        'ada@example.test',
        'a long test password',
      );
    });

    it('signs in to the official origin exactly as configured, keeping the cache namespace', async () => {
      await render();
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'a long test password');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(native.login).toHaveBeenCalledOnceWith(
        OFFICIAL,
        'ada@example.test',
        'a long test password',
      );
      // The password is gone from the form once the attempt is over.
      expect(el<HTMLInputElement>('input[name="password"]')!.value).toBe('');
    });

    it('keeps password-manager hints and offers Email, not "Email or username"', async () => {
      await render();
      const email = el<HTMLInputElement>('input[name="identifier"]')!;
      expect(email.getAttribute('autocomplete')).toBe('username');
      expect(email.type).toBe('email');
      expect(
        email.closest('mat-form-field')!.querySelector('mat-label')!.textContent!.trim(),
      ).toBe('Email');
      const password = el<HTMLInputElement>('input[name="password"]')!;
      expect(password.getAttribute('autocomplete')).toBe('current-password');
      expect(el('form button[type="submit"]')).not.toBeNull();
      expect(fixture.nativeElement.querySelectorAll('button[type="submit"]').length).toBe(
        1,
      );
    });

    it('shows and hides the password with an accessible, pressed-state toggle', async () => {
      await render();
      const toggle = el<HTMLButtonElement>('button[aria-pressed]')!;
      expect(toggle.getAttribute('aria-label')).toBe('Toggle password visibility');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(el<HTMLInputElement>('input[name="password"]')!.type).toBe('password');
      toggle.click();
      await settle();
      expect(el<HTMLInputElement>('input[name="password"]')!.type).toBe('text');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
    });

    it('does not paint an empty field as an error before anything was submitted', async () => {
      await render();
      const email = el<HTMLInputElement>('input[name="identifier"]')!;
      email.focus();
      email.blur();
      el<HTMLInputElement>('input[name="password"]')!.focus();
      el<HTMLInputElement>('input[name="password"]')!.blur();
      await settle();
      expect(el('.mat-form-field-invalid')).toBeNull();
      expect(email.getAttribute('aria-required')).toBe('true');
    });

    it('opens the account website at its sign-up view and its sign-in page', async () => {
      await render();
      button('Create account')!.click();
      await settle();
      expect(native.openAccount).toHaveBeenCalledWith(OFFICIAL, 'signup');
      button('Forgot password?')!.click();
      await settle();
      expect(native.openAccount).toHaveBeenCalledWith(OFFICIAL, undefined);
      expect(button('Account dashboard')).toBeUndefined();
    });

    it('checks the server address for the browser sign-in too, inline', async () => {
      await render();
      await chooseServer('Custom server');
      button('Sign in with browser')!.click();
      await settle();
      expect(accountLogin.start).not.toHaveBeenCalled();
      expect(text()).toContain('Enter your server address.');
    });

    it('starts the browser sign-in with the chosen server and the typed email', async () => {
      await render();
      await type('input[name="identifier"]', 'ada@example.test');
      button('Sign in with browser')!.click();
      await settle();
      expect(accountLogin.start).toHaveBeenCalledOnceWith(OFFICIAL, 'ada@example.test');
    });

    it('shows a sign-in problem in the card, once, as an alert', async () => {
      native.login.and.rejectWith(new Error('Incorrect email or password'));
      await render();
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'wrong');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      const alerts = fixture.nativeElement.querySelectorAll('[role="alert"]');
      expect(alerts.length).toBe(1);
      expect(alerts[0].querySelectorAll('p').length).toBe(1);
      expect(alerts[0].textContent).toContain('Incorrect email or password');
      expect(alerts[0].closest('section')).not.toBeNull();
    });

    it('puts the cursor in the first empty field on entry', async () => {
      await render();
      expect(document.activeElement).toBe(el('input[name="identifier"]'));
    });

    it('moves on to the password when the email is already known', async () => {
      native.configured.set(true);
      native.phase.set('locked');
      native.accountIdentity.set({ email: 'ada@example.test', id: ACCOUNT_ID });
      await render();
      expect(document.activeElement).toBe(el('input[name="password"]'));
    });

    it('starts with the address field when a custom server has none yet', async () => {
      await render();
      await chooseServer('Custom server');
      expect(document.activeElement).toBe(el('input[name="server"]'));
    });

    it('invites a configured but locked account back in with its status, not as a new one', async () => {
      native.configured.set(true);
      native.phase.set('locked');
      native.accountIdentity.set({ email: 'ada@example.test', id: ACCOUNT_ID });
      await render();
      expect(el('h2')!.textContent).toContain('Unlock to resume sync');
      expect(el<HTMLInputElement>('input[name="identifier"]')!.value).toBe(
        'ada@example.test',
      );
      expect(button('Create account')).toBeUndefined();
      // It signs in to the server it already uses: no server choice, just where it goes.
      expect(el('mat-radio-group')).toBeNull();
      expect(el('input[name="server"]')).toBeNull();
      expect(text()).toContain('Signing in to accounts.example.test');
      expect(button('Sign out of this device')).toBeDefined();
      button('Sign out of this device')!.click();
      await settle();
      expect(native.disconnect).toHaveBeenCalled();
    });
  });

  describe('steps after sign-in', () => {
    beforeEach(configure);

    it('moves to two-factor in the same card, with Back and the security-key button', async () => {
      native.login.and.resolveTo(false);
      native.mfaMethods.set(['totp', 'webauthn']);
      await render();
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'a long test password');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(fixture.nativeElement.querySelectorAll('section').length).toBe(1);
      expect(el('h2')!.textContent).toContain('Two-factor authentication');
      expect(el('input[name="code"]')).not.toBeNull();
      expect(el('input[name="identifier"]')).toBeNull();
      expect(button('Verify')).toBeDefined();
      expect(button('Use security key or passkey')).toBeDefined();
      await type('input[name="code"]', '123456');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(native.completeMfa).toHaveBeenCalledWith('123456');
    });

    it('focuses the code field when the two-factor step appears', async () => {
      native.login.and.resolveTo(false);
      await render();
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'a long test password');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(document.activeElement).toBe(el('input[name="code"]'));
    });

    it('goes Back from two-factor to sign-in', async () => {
      native.login.and.resolveTo(false);
      await render();
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'a long test password');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(button('Use security key or passkey')).toBeUndefined();
      button('Back')!.click();
      await settle();
      expect(native.lock).toHaveBeenCalled();
      expect(el('input[name="identifier"]')).not.toBeNull();
      expect(el('input[name="code"]')).toBeNull();
    });

    it('shows the pending browser sign-in as a step with its request code', async () => {
      accountLogin.active.set(true);
      accountLogin.code.set('A1B2C3D4');
      accountLogin.server.set(OFFICIAL);
      await render();
      expect(el('h2')!.textContent).toContain('Finish signing in with your browser');
      expect(text()).toContain('A1B2C3D4');
      expect(el('input[name="identifier"]')).toBeNull();
      button('Reopen browser')!.click();
      await settle();
      expect(accountLogin.open).toHaveBeenCalled();
      button('Cancel')!.click();
      await settle();
      expect(accountLogin.cancel).toHaveBeenCalled();
    });

    it('never shows a signed-in state while a step is pending', async () => {
      native.login.and.resolveTo(false);
      await render();
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'a long test password');
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
      expect(el('.status')).toBeNull();
      expect(button('Sync now')).toBeUndefined();
    });
  });

  describe('verify this device (a new device is asked for an emailed code)', () => {
    beforeEach(configure);

    const step = (over: Partial<DeviceVerificationView> = {}): DeviceVerificationView => {
      // Sent long enough ago that a new code may be requested; valid for the server's ten minutes.
      const issuedAt = over.issuedAt ?? Date.now() - 31_000;
      return {
        emailHint: 'a***@example.test',
        expiresAt: issuedAt + 600_000,
        resendAfter: 30,
        resendsLeft: 3,
        issuedAt,
        ...over,
      };
    };
    const open = (over: Partial<DeviceVerificationView> = {}): void => {
      native.deviceVerification.set(step(over));
      native.phase.set('verify-device');
    };
    const submit = async (): Promise<void> => {
      el<HTMLFormElement>('form')!.dispatchEvent(new Event('submit'));
      await settle();
    };
    /** Unavailable, but still reachable: the button keeps its place in the tab order. */
    const unavailable = (b: HTMLButtonElement): boolean =>
      b.disabled || b.getAttribute('aria-disabled') === 'true';

    it('moves the sign-in on to the code in the same card, naming the masked address only', async () => {
      native.login.and.callFake(async () => {
        open();
        return false;
      });
      await render();
      await type('input[name="identifier"]', 'ada@example.test');
      await type('input[name="password"]', 'a long test password');
      await submit();
      expect(fixture.nativeElement.querySelectorAll('section').length).toBe(1);
      expect(el('h2')!.textContent).toContain('Verify this device');
      expect(text()).toContain('We emailed a code to a***@example.test');
      expect(text()).toContain('The code is valid for 10 minutes.');
      expect(text()).not.toContain('ada@example.test');
      // It is not the two-factor step, and the sign-in form is gone.
      expect(text()).not.toContain('Two-factor');
      expect(button('Use security key or passkey')).toBeUndefined();
      expect(el('input[name="identifier"]')).toBeNull();
      expect(el('input[name="password"]')).toBeNull();
      expect(button('Verify')).toBeDefined();
      expect(button('Send a new code')).toBeDefined();
      expect(button('Back')).toBeDefined();
    });

    it('asks for the code the way a browser and a phone can fill it in', async () => {
      open();
      await render();
      const field = el<HTMLInputElement>('input[name="code"]')!;
      expect(field.getAttribute('autocomplete')).toBe('one-time-code');
      expect(field.getAttribute('inputmode')).toBe('numeric');
      expect(field.required).toBeTrue();
      expect(field.getAttribute('aria-describedby')).toBe('device-code-intro');
      expect(el('#device-code-intro')!.textContent).toContain('We emailed a code');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('label, mat-label')!
          .textContent,
      ).toContain('Verification code');
    });

    it('puts the cursor on the code when the step appears', async () => {
      open();
      await render();
      expect(document.activeElement).toBe(el('input[name="code"]'));
    });

    it('verifies on Enter with what was typed, spaces and all', async () => {
      open();
      await render();
      await type('input[name="code"]', '1234 5678');
      await submit();
      expect(native.completeDeviceVerification).toHaveBeenCalledOnceWith('1234 5678');
    });

    it('shows a wrong code as one alert, once, and puts the cursor back on it', async () => {
      open();
      native.completeDeviceVerification.and.rejectWith(
        new Error('ACCOUNT_DEVICE.ERROR_CODE'),
      );
      await render();
      await type('input[name="code"]', '00000000');
      await submit();
      const alerts = (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[role="alert"]',
      );
      expect(alerts.length).toBe(1);
      expect(alerts[0].textContent).toContain('That code did not work or has expired.');
      expect(el('h2')!.textContent).toContain('Verify this device');
      expect(document.activeElement).toBe(el('input[name="code"]'));
    });

    it('goes Back to the sign-in, which comes back untouched', async () => {
      open();
      native.cancelDeviceVerification.and.callFake(async () => {
        native.deviceVerification.set(null);
        native.phase.set('signed-out');
      });
      await render();
      button('Back')!.click();
      await settle();
      expect(native.cancelDeviceVerification).toHaveBeenCalledTimes(1);
      expect(el('input[name="identifier"]')).not.toBeNull();
      expect(el('input[name="code"]')).toBeNull();
      expect(el('h2')!.textContent).toContain('Sign in to your Ultra Tasks account');
    });

    it('returns to the sign-in with the reason when the server closed the challenge', async () => {
      open();
      native.resendDeviceVerification.and.callFake(async () => {
        native.deviceVerification.set(null);
        native.phase.set('signed-out');
        throw new Error('ACCOUNT_DEVICE.ERROR_ENDED');
      });
      await render();
      button('Send a new code')!.click();
      await settle();
      expect(el('input[name="identifier"]')).not.toBeNull();
      const alert = el('[role="alert"]')!;
      expect(alert.textContent).toContain('expired or was closed');
    });

    it('never shows a signed-in state while the code is awaited', async () => {
      open();
      await render();
      expect(el('.status')).toBeNull();
      expect(button('Sync now')).toBeUndefined();
    });

    it('counts the server’s cooldown down in plain sight, silently, and says only when it ends', fakeAsync(() => {
      // Three seconds of the server's 30-second cooldown are left.
      open({ issuedAt: Date.now() - 27_000 });
      fixture = TestBed.createComponent(NativeSyncComponent);
      fixture.detectChanges();
      flushMicrotasks();
      fixture.detectChanges();
      const resend = (): HTMLButtonElement => button('Send a new code')!;
      const note = (): HTMLElement => el('.resend-note')!;
      const live = (): string =>
        el(
          '[role="status"].resend-note, .resend-note [role="status"]',
        )!.textContent!.trim();
      expect(unavailable(resend())).toBeTrue();
      // Waiting does not take the button out of reach of a keyboard or a screen reader.
      expect(resend().disabled).toBeFalse();
      expect(note().textContent).toContain('New code available in 3 s');
      // The ticking seconds are hidden from screen readers; the live text stays empty.
      expect(note().querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(live()).toBe('');

      tick(1000);
      fixture.detectChanges();
      expect(note().textContent).toContain('New code available in 2 s');
      expect(live()).toBe('');

      tick(2000);
      fixture.detectChanges();
      expect(unavailable(resend())).toBeFalse();
      expect(note().textContent).not.toContain('New code available');
      expect(live()).toBe('You can send a new code now.');
      discardPeriodicTasks();
    }));

    it('keeps "Send a new code" off while the page is busy and after the last code', async () => {
      open({ resendsLeft: 0 });
      await render();
      expect(unavailable(button('Send a new code')!)).toBeTrue();
      button('Send a new code')!.click();
      await settle();
      expect(native.resendDeviceVerification).not.toHaveBeenCalled();
      native.deviceVerification.set(step({ resendsLeft: 1 }));
      await settle();
      expect(unavailable(button('Send a new code')!)).toBeFalse();
    });

    it('sends a new code and says so in plain sight', async () => {
      open();
      native.resendDeviceVerification.and.callFake(async () => {
        native.deviceVerification.set(step({ issuedAt: Date.now(), resendsLeft: 2 }));
      });
      await render();
      button('Send a new code')!.click();
      await settle();
      expect(native.resendDeviceVerification).toHaveBeenCalledTimes(1);
      const status = el('.resend-note [role="status"]')!;
      expect(status.textContent).toContain('A new code was sent to a***@example.test.');
      // The server's cooldown starts again.
      expect(unavailable(button('Send a new code')!)).toBeTrue();
      expect(el('.resend-note')!.textContent).toContain('New code available in');
    });

    it('forgets the typed code when the step ends', async () => {
      open();
      await render();
      await type('input[name="code"]', '12345678');
      native.deviceVerification.set(null);
      native.phase.set('signed-out');
      await settle();
      native.deviceVerification.set(step());
      native.phase.set('verify-device');
      await settle();
      expect(el<HTMLInputElement>('input[name="code"]')!.value).toBe('');
    });
  });

  describe('data connection not finished', () => {
    beforeEach(configure);

    it('explains that tasks are not syncing and offers Finish connecting, not Sync now', async () => {
      signIn();
      native.linked.set(false);
      native.phase.set('choose-data');
      await render();
      expect(text()).toContain('Data connection not finished');
      expect(text()).toContain('Your tasks are not syncing yet.');
      const finish = button('Finish connecting')!;
      expect(finish).toBeDefined();
      expect(button('Sync now')).toBeUndefined();
      expect(el('.status')!.getAttribute('data-status')).toBe('choose-data');
      expect(el('.status')!.getAttribute('data-severity')).toBe('warning');
      finish.click();
      await settle();
      expect(native.resumeDataConnection).toHaveBeenCalled();
    });

    it('does not claim success while the data choice is pending', async () => {
      signIn();
      native.linked.set(false);
      native.phase.set('choose-data');
      await render();
      expect(text()).not.toContain('Up to date');
      expect(text()).not.toContain('Signed in.');
    });
  });

  describe('signed in', () => {
    beforeEach(configure);

    it('shows the identity, the shared status and one primary action', async () => {
      signIn();
      await render();
      expect(el('h2')!.textContent).toContain('ada@example.test');
      expect(text()).toContain('accounts.example.test');
      expect(el('.status')!.getAttribute('data-status')).toBe('up-to-date');
      expect(el('.status-label')!.textContent).toContain('Up to date');
      expect(text()).not.toContain('Sync complete');
      expect(button('Sync now')!.disabled).toBeFalse();
      expect(button('Account dashboard')).toBeDefined();
      expect(el('.data-card')).toBeNull();
      expect(
        fixture.nativeElement.querySelectorAll('button.mat-mdc-unelevated-button').length,
      ).toBe(1);
    });

    it('runs the native engine from Sync now and disables it while busy', async () => {
      signIn();
      await render();
      button('Sync now')!.click();
      await settle();
      expect(native.syncNow).toHaveBeenCalled();
      native.busy.set(true);
      await settle();
      expect(button('Sync now')!.disabled).toBeTrue();
    });

    it('shows when it last synced and how many changes wait', async () => {
      signIn();
      native.lastSyncedAt.set(Date.now() - FIVE_MINUTES);
      native.pendingChanges.set(3);
      await render();
      expect(text()).toContain('Last synced 5 minutes ago');
      expect(text()).toContain('Changes waiting to sync: 3');
    });

    it('shows an offline account as saved on this device, not as failed', async () => {
      signIn();
      native.offline.set(true);
      await render();
      expect(el('.status')!.getAttribute('data-status')).toBe('offline');
      expect(text()).toContain('Offline — changes saved on this device');
      expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(0);
    });

    it('puts a failure in the card as one alert and keeps the failed status ahead of success', async () => {
      signIn();
      native.error.set('The server could not apply the change');
      await render();
      expect(el('.status')!.getAttribute('data-status')).toBe('error');
      expect(text()).toContain('Sync failed');
      const alerts = fixture.nativeElement.querySelectorAll('[role="alert"]');
      expect(alerts.length).toBe(1);
      expect(alerts[0].querySelectorAll('p').length).toBe(1);
      expect(alerts[0].textContent).toContain('The server could not apply the change');
      expect(text()).not.toContain('Up to date');
    });

    it('keeps the account ID read-only, copyable and clearly not a password', async () => {
      signIn();
      await render();
      el<HTMLElement>('details.account-details summary')!.click();
      await settle();
      const id = el<HTMLInputElement>('input[readonly]')!;
      expect(id.value).toBe(ACCOUNT_ID);
      expect(text()).toContain('Account ID');
      expect(text()).toContain(
        'Share this ID with support. It is not a password and does not prove you own the account.',
      );
      const copy = button('Copy')!;
      expect(copy.getAttribute('aria-label')).toBe('Copy Account ID');
      expect(el('[role="status"].copy-status')!.textContent!.trim()).toBe('');
      copy.click();
      await settle();
      expect(share.copyToClipboard).toHaveBeenCalledOnceWith(ACCOUNT_ID, 'Account ID');
      expect(el('[role="status"].copy-status')!.textContent).toContain('Copied');
    });

    it('says so when the ID could not be copied', async () => {
      signIn();
      share.copyToClipboard.and.resolveTo({ success: false });
      await render();
      button('Copy')!.click();
      await settle();
      expect(el('[role="status"].copy-status')!.textContent).toContain('Could not copy');
    });

    it('keeps lock, sign out and delete in a separate, closed Account options disclosure', async () => {
      signIn();
      await render();
      const options = el<HTMLDetailsElement>('details.account-options')!;
      expect(options.open).toBeFalse();
      expect(options.querySelector('summary')!.textContent).toContain('Account options');
      expect(options.textContent).toContain('Lock');
      expect(options.textContent).toContain('Sign out of this device');
      expect(options.querySelector('.danger-area')!.textContent).toContain(
        'Delete cloud account',
      );
      expect(el<HTMLDetailsElement>('details.account-details')!.open).toBeFalse();
      button('Lock')!.click();
      await settle();
      expect(native.lock).toHaveBeenCalled();
      button('Sign out of this device')!.click();
      await settle();
      expect(native.logout).toHaveBeenCalled();
    });

    it('keeps published calendars in a closed section under the account card', async () => {
      signIn();
      await render();
      const calendars = el<HTMLDetailsElement>('details.calendar-publications')!;
      expect(calendars).not.toBeNull();
      expect(calendars.open).toBeFalse();
      expect(calendars.querySelector('summary')!.textContent).toContain(
        'Published calendars',
      );
      const sections = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '.account-card, details.calendar-publications',
        ),
      );
      expect(sections.indexOf(calendars)).toBeGreaterThan(0);
      // The plaintext-export disclosure and opt-in consent stay in the section.
      expect(calendars.textContent).toContain(
        'This copy is outside end-to-end encryption.',
      );
      expect(calendars.querySelector('mat-checkbox')).not.toBeNull();
      const publish = Array.from(calendars.querySelectorAll('button')).find((b) =>
        (b.textContent ?? '').includes('Publish calendar'),
      )!;
      expect(publish.disabled).toBeTrue();
    });

    it('does not offer calendars before the account is connected to its data', async () => {
      signIn();
      native.linked.set(false);
      native.phase.set('choose-data');
      await render();
      expect(el('details.calendar-publications')).toBeNull();
    });
  });

  describe('landing on the tasks after the first connection', () => {
    beforeEach(configure);

    it('opens the task list once the first download has been applied', async () => {
      signIn();
      native.linked.set(false);
      native.phase.set('choose-data');
      await render();
      native.phase.set('downloading');
      await settle();
      native.phase.set('applying');
      await settle();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      native.linked.set(true);
      native.phase.set('synced');
      await settle();
      expect(router.navigateByUrl).toHaveBeenCalledOnceWith('/');
    });

    it('stays on the account page for ordinary background syncs', async () => {
      signIn();
      await render();
      for (let i = 0; i < 3; i++) {
        native.phase.set('syncing');
        await settle();
        native.phase.set('synced');
        await settle();
      }
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('stays on the account page when an already-linked device finishes applying data', async () => {
      signIn();
      native.phase.set('applying');
      await render();
      native.phase.set('synced');
      await settle();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });
  });

  describe('status announcements', () => {
    beforeEach(configure);
    const announcement = (): string =>
      (el('p[role="status"].cdk-visually-hidden')?.textContent ?? '').trim();

    it('is quiet on entry and for background syncs', async () => {
      signIn();
      await render();
      expect(announcement()).toBe('');
      native.phase.set('syncing');
      await settle();
      native.phase.set('synced');
      await settle();
      expect(announcement()).toBe('');
    });

    it('announces meaningful changes once, in the shared vocabulary', async () => {
      signIn();
      await render();
      native.offline.set(true);
      await settle();
      expect(announcement()).toBe('Offline — changes saved on this device');
      native.offline.set(false);
      await settle();
      expect(announcement()).toBe('Up to date');
    });

    it('announces the outcome of a manual sync', async () => {
      signIn();
      await render();
      button('Sync now')!.click();
      await settle();
      await fixture.whenStable();
      expect(announcement()).toBe('Up to date');
    });
  });
});
