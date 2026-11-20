import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { formatDate, NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { firstValueFrom, map, timer } from 'rxjs';
import { CalendarPublicationsComponent } from '../integrations/calendar-publications.component';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NativeSyncService } from './native-sync.service';
import { isUploadDraft } from './native-sync-health';
import { NativeAccountLoginService } from './native-account-login.service';
import { AccountSyncStatusService } from './account-sync-status.service';
import type { AccountStatusId, AccountSyncStatus } from './account-sync-status.model';
import type { AccountPhase } from './account-sync.types';
import { normalizeServerUrl } from './native-server-url.util';
import { StateSnapshotService } from '../../op-log/backup/state-snapshot.service';
import {
  sharedTaskFromPersonal,
  type Invitation,
  type SharedTask,
  type TaskOverlay,
  type OwnershipOffer,
} from '@sp/sync-providers/ultra-tasks';
import { T } from '../../t.const';
import { DateService } from '../../core/date/date.service';
import { download } from '../../util/download';
import { MatDialog } from '@angular/material/dialog';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { ActivatedRoute, Router } from '@angular/router';
import { getEnvOptional } from '../../util/env';
import { humanizeTimestamp } from '../../util/humanize-timestamp';
import { isTouchActive } from '../../util/input-intent';
import { environment } from '../../../environments/environment';
import { ShareService } from '../../core/share/share.service';
import { selectAllProjects } from '../project/store/project.selectors';

type ServerMode = 'official' | 'custom';
/** Moving between these is ordinary background syncing; it is never announced on its own. */
const BACKGROUND_SYNC_STATES: readonly AccountStatusId[] = [
  'syncing',
  'up-to-date',
  'up-to-date-empty',
];
const COPY_CONFIRMATION_MS = 4000;
const millis = (seconds: number): number => seconds * 1000;

const hostOf = (url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/**
 * The Ultra Tasks account page: one centred column with the state the account is in.
 *
 * Signed out: server choice (the address field exists only for a custom server), Email and
 * Password, then successive steps in the same card (browser approval, two-factor). Signed in:
 * identity, the shared sync status, one primary action, then quiet details and options.
 */
@Component({
  selector: 'native-sync',
  imports: [
    CalendarPublicationsComponent,
    FormsModule,
    NgTemplateOutlet,
    TranslatePipe,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatRadioModule,
  ],
  templateUrl: './native-sync.component.html',
  styleUrl: './native-sync.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NativeSyncComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly translate = inject(TranslateService);
  private readonly share = inject(ShareService);
  readonly native = inject(NativeSyncService);
  readonly accountLogin = inject(NativeAccountLoginService);
  /** The one derived sync status every account surface shows. */
  readonly accountStatus = inject(AccountSyncStatusService).status;
  private readonly snapshots = inject(StateSnapshotService);
  private readonly dateService = inject(DateService);
  private readonly dialogs = inject(MatDialog);
  readonly checkpoints = signal<{ scopeId: string; sequence: number }[]>([]);
  readonly T = T;
  readonly officialServer =
    getEnvOptional('ULTRA_ACCOUNT_URL') ??
    (environment.production ? 'https://app.ultratasks.app' : '');
  private readonly storedServer =
    localStorage.getItem('ultra-native-server') ?? this.officialServer;
  serverMode: ServerMode =
    this.officialServer &&
    (!this.storedServer || this.storedServer === this.officialServer)
      ? 'official'
      : 'custom';
  /** The custom address the user typed; kept when they switch to the official server and back. */
  customServer = this.serverMode === 'custom' ? this.storedServer : '';
  /** Translation key of the problem with the selected server address, shown under its field. */
  readonly serverError = signal('');
  readonly serverErrorMatcher: ErrorStateMatcher = {
    isErrorState: () => !!this.serverError(),
  };
  /** Nothing is validated before a submit: an empty field is not painted as an error. */
  readonly plainFieldMatcher: ErrorStateMatcher = { isErrorState: () => false };
  identifier = this.native.accountIdentity()?.email ?? '';
  password = '';
  readonly showPassword = signal(false);
  mfa = '';
  readonly needsMfa = signal(false);
  /** The emailed code of "Verify this device" (a sign-in on a device the account does not know). */
  deviceCode = '';
  /** The pending step, or null. It lives in the engine: leaving the page does not lose it. */
  readonly deviceVerification = this.native.deviceVerification;
  /** Ticks once a second while that step is open, so the resend cooldown counts down. */
  private readonly clock = signal(Date.now());
  /** Seconds until the server lets a new code be requested; 0 when it may be requested now. */
  readonly resendIn = computed(() => {
    const step = this.deviceVerification();
    if (!step) return 0;
    const until = step.issuedAt + millis(step.resendAfter);
    return Math.max(0, Math.ceil((until - this.clock()) / 1000));
  });
  readonly canResend = computed(
    () =>
      !!this.deviceVerification() && this.resendIn() === 0 && this.resendsLeft() !== 0,
  );
  private readonly resendsLeft = computed(() => this.deviceVerification()?.resendsLeft);
  /** How long the code that was just sent stays valid, in whole minutes. */
  readonly codeMinutes = computed(() => {
    const step = this.deviceVerification();
    return step ? Math.max(1, Math.ceil((step.expiresAt - step.issuedAt) / 60_000)) : 0;
  });
  /** Polite live text of the step, shown too: a sent code and the end of the cooldown only. */
  readonly deviceNote = signal('');
  private previousResendIn = 0;
  projectTitle = '';
  sourceProject = '';
  includeDescription = false;
  recipient = '';
  role: 'editor' | 'viewer' = 'editor';
  newTitle = '';
  readonly selected = signal('');
  readonly working = signal(false);
  readonly message = signal('');
  readonly scope = computed(() =>
    this.native.projects().find((s) => s.id === this.selected()),
  );
  readonly canEdit = computed(
    () =>
      this.scope()?.state === 'active' &&
      this.scope()?.members.find(
        (m) => m.authorization.accountId === this.native.account?.account?.id,
      )?.authorization.role !== 'viewer',
  );
  readonly isOwner = computed(
    () => !!this.scope() && this.scope()?.ownerId === this.native.account?.account?.id,
  );
  readonly personalProjects = inject(Store).selectSignal(selectAllProjects);
  readonly personalScopeInfo = computed(() =>
    this.native.scopes().find((scope) => scope.kind === 'personal'),
  );
  readonly privateRecords = computed(() => {
    this.native.revision();
    const scope = this.native.scopes().find((s) => s.kind === 'personal');
    return scope ? (this.native.client?.records(scope.id) ?? {}) : {};
  });
  readonly privateHistory = computed(() =>
    Object.values(this.privateRecords())
      .filter((h) => h.entityType === 'personal.overlay')
      .map((h) => h.value as TaskOverlay),
  );
  readonly tasks = computed(() => {
    this.native.revision();
    return Object.values(this.native.client?.records(this.selected()) ?? {})
      .filter((record) => record.entityType === 'shared.task')
      .map((record) => ({
        id: record.entityId,
        task: record.value as SharedTask,
        overlay: this.overlay(record.entityId),
        reminderLocal: this.overlay(record.entityId).remindAt
          ? formatDate(
              this.overlay(record.entityId).remindAt!,
              "yyyy-MM-dd'T'HH:mm",
              'en-US',
            )
          : '',
        loggedMinutes:
          Object.values(this.overlay(record.entityId).timeBuckets ?? {}).reduce(
            (sum, n) => sum + n,
            0,
          ) / 60000,
      }))
      .sort(
        (a, b) => (a.task.rank ?? 0) - (b.task.rank ?? 0) || a.id.localeCompare(b.id),
      );
  });
  readonly drafts = computed(() => {
    this.native.revision();
    return Object.values(this.native.client?.state.scopes ?? {}).flatMap((s) => [
      ...s.conflicts.map((d) => ({ ...d, scopeId: s.info.id })),
      ...(s.revoked
        ? s.intents.flatMap((intent) =>
            intent.changes.map((change) => ({
              id: intent.id + ':' + change.entityId,
              entityId: change.entityId,
              value: change.value,
              reason: 'permission',
              createdAt: 0,
              scopeId: s.info.id,
            })),
          )
        : []),
    ]);
  });
  readonly hasConflictDrafts = computed(() =>
    this.drafts().some((draft) => !isUploadDraft(draft)),
  );
  readonly uploadDraftTitles = computed(() => {
    const titles = this.drafts()
      .filter(isUploadDraft)
      .map((draft) => {
        const value = draft.value as { data?: { title?: unknown } } | null;
        return value?.data?.title;
      });
    return [
      ...new Set(
        titles.filter((title): title is string => typeof title === 'string' && !!title),
      ),
    ];
  });
  /** The problem to show in the card next to the step's action (not under a field). */
  readonly errorText = computed(
    () =>
      this.message() ||
      (this.native.unlocked() ? this.native.error() : this.accountLogin.error()),
  );
  /** Signed in, but this device has not chosen which data to sync yet. */
  readonly showDataCard = computed(
    () =>
      this.native.unlocked() &&
      !this.native.canRecoverPersonal() &&
      this.native.phase() === 'choose-data',
  );
  /** A configured account whose keys are closed: the sign-in card says so instead of "new". */
  readonly resumeStatus = computed(() => {
    const status = this.accountStatus();
    return !this.native.unlocked() && (status.id === 'locked' || status.id === 'reauth')
      ? status
      : null;
  });
  readonly identity = computed(() => this.native.accountIdentity());
  private readonly now = toSignal(timer(0, 30_000).pipe(map(() => Date.now())), {
    initialValue: Date.now(),
  });
  /** "5 minutes ago": refreshed every 30 seconds so an idle page does not go stale. */
  readonly lastSyncedText = computed(() => {
    this.now();
    const at = this.accountStatus().lastSyncedAt;
    return at ? humanizeTimestamp(at, this.translate) : '';
  });
  /** Polite live-region text: only meaningful changes, never every background sync. */
  readonly announcement = signal('');
  readonly copyResult = signal<'' | 'copied' | 'failed'>('');
  private copyTimer?: ReturnType<typeof setTimeout>;
  private previousStatus: AccountStatusId | null = null;
  private initialConnectionPending = false;
  private readonly serverField = viewChild<ElementRef<HTMLInputElement>>('serverField');
  private readonly identifierField =
    viewChild<ElementRef<HTMLInputElement>>('identifierField');
  private readonly passwordField =
    viewChild<ElementRef<HTMLInputElement>>('passwordField');
  private readonly codeField = viewChild<ElementRef<HTMLInputElement>>('codeField');

  constructor() {
    this.destroyRef.onDestroy(() => clearTimeout(this.copyTimer));
    // A step's first empty field takes focus when the step appears (not on touch screens,
    // where it would raise the keyboard over the card).
    effect(() => {
      const fields = [
        this.codeField(),
        this.serverField(),
        this.identifierField(),
        this.passwordField(),
      ];
      untracked(() => this.focusFirstEmpty(fields));
    });
    effect(() => {
      const phase = this.native.phase();
      untracked(() => this.leaveAfterInitialConnection(phase));
    });
    // While the emailed-code step is open the clock ticks; otherwise nothing runs.
    effect((onCleanup) => {
      if (!this.deviceVerification()) {
        this.deviceCode = '';
        untracked(() => this.deviceNote.set(''));
        return;
      }
      this.clock.set(Date.now());
      const tick = setInterval(() => this.clock.set(Date.now()), 1000);
      onCleanup(() => clearInterval(tick));
    });
    // Only the end of the cooldown is worth saying out loud, never each second of it.
    effect(() => {
      const seconds = this.resendIn();
      untracked(() => {
        if (this.previousResendIn > 0 && seconds === 0 && this.canResend())
          this.deviceNote.set(this.translate.instant(T.ACCOUNT_DEVICE.RESEND_READY));
        this.previousResendIn = seconds;
      });
    });
    effect(() => {
      const status = this.accountStatus();
      untracked(() => this.announceTransition(status));
    });
  }
  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const scope = params.get('scope');
        if (scope) this.selected.set(scope);
      });
  }
  /** The address that sign-in, the browser flow and the website links would use. */
  get server(): string {
    return this.serverMode === 'official' && this.officialServer
      ? this.officialServer
      : this.customServer;
  }
  /**
   * The address field exists only for a custom server (or when no official one is built in),
   * and not at all when a configured account just signs in again to the server it already uses.
   */
  get showServerField(): boolean {
    return !this.resumeStatus() && (!this.officialServer || this.serverMode === 'custom');
  }
  /** Where the sign-in goes, as quiet text, when there is no address field to show it. */
  get serverHostName(): string {
    return hostOf(this.server);
  }
  get serverHost(): string {
    return hostOf(this.native.serverUrl);
  }
  selectServerMode(mode: ServerMode): void {
    this.serverMode = mode;
    this.serverError.set('');
  }
  /**
   * Validates the origin the user actually selected before anything is sent. A problem is shown
   * inline under the address field, which takes focus. Returns the address when it is usable.
   */
  private validServer(): string | null {
    const address = this.server.trim();
    let problem = '';
    if (!address) problem = T.ACCOUNT_PAGE.SERVER_REQUIRED;
    else {
      try {
        normalizeServerUrl(address);
      } catch {
        problem = T.NATIVE_SYNC.ERROR_URL;
      }
    }
    this.serverError.set(this.showServerField ? problem : '');
    if (!problem) return address;
    if (this.showServerField) this.serverField()?.nativeElement.focus();
    else this.message.set(problem);
    return null;
  }
  private focusFirstEmpty(fields: (ElementRef<HTMLInputElement> | undefined)[]): void {
    if (isTouchActive()) return;
    const [code, server, identifier, password] = fields;
    const target =
      code ??
      (server && !this.customServer.trim() ? server : undefined) ??
      (identifier && !this.identifier.trim() ? identifier : undefined) ??
      password ??
      identifier;
    target?.nativeElement.focus();
  }
  /**
   * Landing on the task list after the first connection (data chosen, downloaded and applied)
   * is the point of signing in. Ordinary incremental syncs never navigate.
   */
  private leaveAfterInitialConnection(phase: AccountPhase): void {
    if (phase === 'choose-data' || phase === 'downloading' || phase === 'applying') {
      this.initialConnectionPending ||= !this.native.linked();
    } else if (phase === 'synced' && this.initialConnectionPending) {
      this.initialConnectionPending = false;
      void this.router.navigateByUrl('/');
    } else if (phase !== 'syncing') this.initialConnectionPending = false;
  }
  private announceTransition(status: AccountSyncStatus): void {
    if (!this.native.unlocked()) {
      this.previousStatus = null;
      return;
    }
    const previous = this.previousStatus;
    this.previousStatus = status.id;
    if (previous === null || previous === status.id) return;
    // Background sync flips between these every minute; an explicit "Sync now" announces itself.
    if (
      BACKGROUND_SYNC_STATES.includes(previous) &&
      BACKGROUND_SYNC_STATES.includes(status.id)
    )
      return;
    this.announce(status);
  }
  private announce(status: AccountSyncStatus): void {
    this.announcement.set(this.translate.instant(status.labelKey));
  }
  /** Manual sync from the account card; the outcome is announced once it is known. */
  async syncNow(): Promise<void> {
    this.announcement.set('');
    await this.native.syncNow();
    this.announce(this.accountStatus());
  }
  async recoverPersonalSync(): Promise<void> {
    await this.run(() =>
      this.native.recoverPersonalSync(async (archive) => {
        const result = await download(
          'ultra-tasks-personal-sync-recovery.json',
          JSON.stringify(archive, null, 2),
        );
        if (result.wasCanceled || (result.isSnap && !result.path)) return false;
        return this.confirm(T.NATIVE_SYNC.HISTORY_REJOIN_CONFIRM);
      }),
    );
  }
  async copyAccountId(): Promise<void> {
    const id = this.identity()?.id;
    if (!id) return;
    const result = await this.share.copyToClipboard(id, 'Account ID');
    this.copyResult.set(result.success ? 'copied' : 'failed');
    clearTimeout(this.copyTimer);
    this.copyTimer = setTimeout(() => this.copyResult.set(''), COPY_CONFIRMATION_MS);
  }
  title(scopeId: string): string {
    this.native.revision();
    return (
      (this.native.client?.record(scopeId, 'project')?.value as { title?: string })
        ?.title ?? scopeId.slice(0, 8)
    );
  }
  private personalScope(): string {
    const scope = this.native.scopes().find((s) => s.kind === 'personal');
    if (!scope) throw new Error('NATIVE_SYNC.ERROR_NO_PERSONAL');
    return scope.id;
  }
  private overlay(taskId: string): TaskOverlay {
    const record = this.privateRecords()[this.overlayId(taskId)];
    return (
      (record?.value as TaskOverlay) ?? { scopeId: this.selected(), taskId, label: '' }
    );
  }
  private overlayId(taskId: string): string {
    return 'overlay:' + this.selected() + ':' + taskId;
  }
  async run(action: () => Promise<void>): Promise<void> {
    this.working.set(true);
    this.message.set('');
    try {
      await action();
      this.native.revision.update((n) => n + 1);
    } catch (error) {
      this.message.set(error instanceof Error ? error.message : 'NATIVE_SYNC.ERROR_SYNC');
    } finally {
      this.working.set(false);
    }
  }
  async login(): Promise<void> {
    this.message.set('');
    const server = this.validServer();
    if (!server) return;
    await this.run(async () => {
      try {
        const signedIn = await this.native.login(server, this.identifier, this.password);
        // A further step is pending: two-factor, or the emailed code of a new device.
        this.needsMfa.set(!signedIn && !this.deviceVerification());
      } finally {
        this.password = '';
      }
    });
  }
  /** The account website for the selected server: sign-up, or the sign-in and recovery page. */
  async openDashboard(view?: 'signup'): Promise<void> {
    this.message.set('');
    const server = this.validServer();
    if (!server) return;
    await this.run(() => this.native.openAccount(server, view));
  }
  async openAccountDashboard(): Promise<void> {
    await this.run(() => this.native.openAccount(this.native.serverUrl));
  }
  async startBrowserLogin(): Promise<void> {
    this.message.set('');
    const server = this.validServer();
    if (!server) return;
    this.password = '';
    this.mfa = '';
    this.needsMfa.set(false);
    await this.run(() => this.accountLogin.start(server, this.identifier));
  }
  async cancelBrowserLogin(): Promise<void> {
    await this.run(() => this.accountLogin.cancel());
  }
  async disconnect(): Promise<void> {
    await this.run(async () => {
      await this.accountLogin.cancel();
      await this.native.disconnect();
      this.identifier = '';
    });
  }
  async reopenBrowserLogin(): Promise<void> {
    await this.run(() => this.accountLogin.open());
  }
  async cancelMfa(): Promise<void> {
    await this.run(async () => {
      await this.native.lock();
      this.mfa = '';
      this.needsMfa.set(false);
    });
  }
  async completeMfa(): Promise<void> {
    await this.run(async () => {
      await this.native.completeMfa(this.mfa);
      this.mfa = '';
      this.needsMfa.set(false);
    });
  }
  async passkey(): Promise<void> {
    await this.run(async () => {
      await this.native.passkey();
      this.needsMfa.set(false);
    });
  }
  /** "Verify this device": the eight digits from the email (spaces and dashes are fine). */
  async completeDeviceVerification(): Promise<void> {
    this.deviceNote.set('');
    await this.run(() => this.native.completeDeviceVerification(this.deviceCode));
    // A wrong code leaves the step open: put the cursor back on it, selected, to retype.
    if (this.deviceVerification()) {
      const field = this.codeField()?.nativeElement;
      field?.focus();
      field?.select();
    }
  }
  async resendDeviceCode(): Promise<void> {
    if (!this.canResend()) return;
    this.deviceNote.set('');
    await this.run(async () => {
      await this.native.resendDeviceVerification();
      const step = this.deviceVerification();
      if (step)
        this.deviceNote.set(
          this.translate.instant(T.ACCOUNT_DEVICE.RESENT, { email: step.emailHint }),
        );
    });
  }
  /** Back: nothing was signed in, so the sign-in form simply comes back. */
  async cancelDeviceVerification(): Promise<void> {
    await this.run(() => this.native.cancelDeviceVerification());
  }
  async runLock(): Promise<void> {
    await this.run(() => this.native.lock());
  }
  /** Reopens the data choice. The choice itself belongs to {@link NativeSyncService}. */
  async finishConnecting(): Promise<void> {
    await this.run(() => this.native.resumeDataConnection());
  }
  async recoverPersonalSetup(setup: { id: string; uploaded: boolean }): Promise<void> {
    if (
      !(await this.confirm(
        setup.uploaded
          ? T.NATIVE_SYNC.RECOVER_SETUP_NOTICE
          : T.NATIVE_SYNC.RESTART_SETUP_NOTICE,
      ))
    )
      return;
    await this.run(() => this.native.recoverAbandonedPersonalSetup(setup.id));
  }
  async createProject(): Promise<void> {
    await this.run(async () => {
      const client = this.native.client!;
      const source = this.snapshots.getStateSnapshot();
      const projects = source.project as { entities: Record<string, { title: string }> };
      const tasks = source.task as { entities: Record<string, Record<string, unknown>> };
      const title =
        this.projectTitle.trim() || projects.entities[this.sourceProject]?.title;
      if (!title) return;
      const scopeId = await client.createScope('project');
      const copied = Object.values(tasks.entities).filter(
        (task) => task?.['projectId'] === this.sourceProject,
      );
      const ids = new Map(copied.map((task) => [task['id'], crypto.randomUUID()]));
      const sections = Object.values(
        (
          source.section as {
            entities: Record<
              string,
              {
                id: string;
                title: string;
                contextId: string;
                contextType: string;
                taskIds: string[];
              }
            >;
          }
        ).entities,
      ).filter(
        (section) =>
          section.contextId === this.sourceProject && section.contextType === 'PROJECT',
      );
      const sectionIds = new Map(
        sections.map((section) => [section.id, crypto.randomUUID()]),
      );
      const taskSections = new Map(
        sections.flatMap((section) =>
          section.taskIds.map((taskId) => [taskId, sectionIds.get(section.id)!] as const),
        ),
      );
      const records = [
        { entityId: 'project', entityType: 'shared.project', value: { title } as object },
        ...sections.map((section, rank) => ({
          entityId: sectionIds.get(section.id)!,
          entityType: 'shared.section',
          value: { title: section.title, rank },
        })),
        ...copied.map((task, rank) => ({
          entityId: ids.get(task['id'])!,
          entityType: 'shared.task',
          value: {
            ...sharedTaskFromPersonal(task, this.includeDescription),
            rank,
            ...(taskSections.has(String(task['id']))
              ? { sectionId: taskSections.get(String(task['id'])) }
              : {}),
            ...(ids.has(task['parentId']) ? { parentId: ids.get(task['parentId']) } : {}),
          },
        })),
      ];
      for (let offset = 0; offset < records.length; offset += 100)
        await client.edit(scopeId, records.slice(offset, offset + 100));
      await client.syncScope(scopeId);
      await this.native.refresh();
      this.selected.set(scopeId);
      this.projectTitle = '';
    });
  }
  async accept(invite: Invitation): Promise<void> {
    await this.run(async () => {
      await this.native.client!.accept(invite);
      await this.native.refresh();
      this.selected.set(invite.scopeId);
    });
  }
  async invite(): Promise<void> {
    await this.run(async () => {
      await this.native.client!.invite(this.selected(), this.recipient, this.role);
      this.recipient = '';
      this.message.set('NATIVE_SYNC.INVITED');
    });
  }
  async removeMember(accountId: string): Promise<void> {
    await this.run(async () => {
      await this.native.client!.removeMember(this.selected(), accountId);
      await this.native.refresh();
    });
  }
  private async confirm(message: string): Promise<boolean> {
    return !!(await firstValueFrom(
      this.dialogs.open(DialogConfirmComponent, { data: { message } }).afterClosed(),
    ));
  }
  async offerOwnership(accountId: string): Promise<void> {
    if (!(await this.confirm('NATIVE_SYNC.TRANSFER_NOTICE'))) return;
    await this.run(async () => {
      await this.native.client!.offerOwnership(this.selected(), accountId);
      this.message.set('NATIVE_SYNC.TRANSFER_SENT');
    });
  }
  async acceptOwnership(offer: OwnershipOffer): Promise<void> {
    if (!(await this.confirm('NATIVE_SYNC.ACCEPT_OWNERSHIP_NOTICE'))) return;
    await this.run(async () => {
      await this.native.client!.acceptOwnership(offer);
      await this.native.refresh();
    });
  }
  async saveCheckpoint(): Promise<void> {
    await this.run(async () => {
      await this.native.client!.checkpoint(this.selected());
      await this.loadCheckpoints();
    });
  }
  async loadCheckpoints(): Promise<void> {
    const scopeId = this.selected();
    await this.run(async () =>
      this.checkpoints.set(
        (await this.native.client!.checkpoints(scopeId)).map((sequence) => ({
          scopeId,
          sequence,
        })),
      ),
    );
  }
  async restore(sequence: number): Promise<void> {
    if (!(await this.confirm('NATIVE_SYNC.RESTORE_NOTICE'))) return;
    await this.run(async () => {
      await this.native.client!.restoreProject(this.selected(), sequence);
      this.checkpoints.set([]);
      await this.native.refresh();
    });
  }
  async deleteProject(): Promise<void> {
    if (!(await this.confirm('NATIVE_SYNC.DELETE_PROJECT_NOTICE'))) return;
    await this.run(async () => {
      await this.native.client!.deleteProject(this.selected());
      this.selected.set('');
      await this.native.refresh();
    });
  }
  async deleteAccount(): Promise<void> {
    if (!(await this.confirm('NATIVE_SYNC.DELETE_ACCOUNT_NOTICE'))) return;
    await this.run(async () => {
      await this.native.deleteAccount();
      this.identifier = '';
    });
  }
  async runSignOut(): Promise<void> {
    await this.run(async () => {
      await this.native.logout();
      this.identifier = '';
    });
  }
  async addTask(): Promise<void> {
    await this.run(async () => {
      if (!this.newTitle.trim()) return;
      await this.native.client!.edit(this.selected(), [
        {
          entityId: crypto.randomUUID(),
          entityType: 'shared.task',
          value: {
            title: this.newTitle.trim(),
            isDone: false,
            rank: this.tasks().length,
          },
        },
      ]);
      this.newTitle = '';
    });
  }
  async editTask(taskId: string, task: SharedTask): Promise<void> {
    await this.run(() =>
      this.native.client!.edit(this.selected(), [
        { entityId: taskId, entityType: 'shared.task', value: task },
      ]),
    );
  }
  async complete(taskId: string, task: SharedTask, isDone: boolean): Promise<void> {
    await this.editTask(taskId, { ...task, isDone });
  }
  async rename(taskId: string, task: SharedTask, title: string): Promise<void> {
    await this.editTask(taskId, { ...task, title });
  }
  async describe(taskId: string, task: SharedTask, description: string): Promise<void> {
    await this.editTask(taskId, { ...task, description });
  }
  async deadline(taskId: string, task: SharedTask, deadlineDay: string): Promise<void> {
    await this.editTask(taskId, {
      ...task,
      deadlineDay: deadlineDay || null,
      deadlineWithTime: null,
    });
  }
  async assign(taskId: string, task: SharedTask, assigneeId: string): Promise<void> {
    await this.editTask(taskId, { ...task, assigneeId: assigneeId || null });
  }
  async deleteTask(taskId: string): Promise<void> {
    await this.run(() =>
      this.native.client!.edit(this.selected(), [
        { entityId: taskId, entityType: 'shared.task', value: null, deleted: true },
      ]),
    );
  }
  async plan(taskId: string, label: string, dueDay: string): Promise<void> {
    await this.run(() =>
      this.native.client!.edit(this.personalScope(), [
        {
          entityId: this.overlayId(taskId),
          entityType: 'personal.overlay',
          value: {
            ...this.overlay(taskId),
            label,
            dueDay: dueDay || null,
            dueWithTime: null,
          },
        },
      ]),
    );
  }
  async scratch(taskId: string, label: string, personalNotes: string): Promise<void> {
    await this.run(() =>
      this.native.client!.edit(this.personalScope(), [
        {
          entityId: this.overlayId(taskId),
          entityType: 'personal.overlay',
          value: { ...this.overlay(taskId), label, personalNotes },
        },
      ]),
    );
  }
  async remind(taskId: string, label: string, localTime: string): Promise<void> {
    await this.run(async () => {
      const remindAt = localTime ? new Date(localTime).getTime() : null;
      if (remindAt !== null && !Number.isFinite(remindAt)) return;
      await this.native.platform.requestReminderPermission();
      await this.native.client!.edit(this.personalScope(), [
        {
          entityId: this.overlayId(taskId),
          entityType: 'personal.overlay',
          value: { ...this.overlay(taskId), label, remindAt },
        },
      ]);
    });
  }
  async logTime(taskId: string, label: string, minutes: string): Promise<void> {
    const amount = Number(minutes);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1440) return;
    // Each device owns a separate bucket; nested three-way merge combines independent devices.
    const deviceId = this.native.client!.state.device.id;
    const workedMs = amount * 60000;
    await this.run(async () => {
      const overlay = this.overlay(taskId) as TaskOverlay & {
        timeBuckets?: Record<string, number>;
      };
      const key = this.dateService.todayStr() + ':' + deviceId;
      await this.native.client!.edit(this.personalScope(), [
        {
          entityId: this.overlayId(taskId),
          entityType: 'personal.overlay',
          value: {
            ...overlay,
            label,
            timeBuckets: {
              ...overlay.timeBuckets,
              [key]: (overlay.timeBuckets?.[key] ?? 0) + workedMs,
            },
          },
        },
      ]);
    });
  }
  async exportDrafts(): Promise<void> {
    await download(
      'ultra-tasks-conflict-drafts.json',
      JSON.stringify(this.drafts(), null, 2),
    );
  }
  async dismissDrafts(): Promise<void> {
    await this.run(async () => {
      for (const scope of Object.values(this.native.client!.state.scopes))
        await this.native.client!.dismissDrafts(scope.info.id);
    });
  }
  async exportPrivateHistory(): Promise<void> {
    await download(
      'ultra-tasks-private-shared-history.json',
      JSON.stringify(this.privateHistory(), null, 2),
    );
  }
}
