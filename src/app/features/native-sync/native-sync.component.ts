import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  OnInit,
  DestroyRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { NativeSyncService } from './native-sync.service';
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
import { firstValueFrom } from 'rxjs';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { formatDate } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { getEnvOptional } from '../../util/env';
import { selectAllProjects } from '../project/store/project.selectors';

@Component({
  selector: 'native-sync',
  imports: [FormsModule, TranslatePipe],
  templateUrl: './native-sync.component.html',
  styleUrl: './native-sync.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NativeSyncComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  readonly native = inject(NativeSyncService);
  private readonly snapshots = inject(StateSnapshotService);
  private readonly dateService = inject(DateService);
  private readonly dialogs = inject(MatDialog);
  readonly checkpoints = signal<{ scopeId: string; sequence: number }[]>([]);
  readonly T = T;
  server =
    localStorage.getItem('ultra-native-server') ??
    getEnvOptional('ULTRA_ACCOUNT_URL') ??
    '';
  identifier = '';
  password = '';
  mfa = '';
  needsMfa = false;
  retiredLegacy = false;
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
  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        const scope = params.get('scope');
        if (scope) this.selected.set(scope);
      });
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
    await this.run(async () => {
      try {
        this.needsMfa = !(await this.native.login(
          this.server,
          this.identifier,
          this.password,
        ));
      } finally {
        this.password = '';
      }
    });
  }
  async runOpenAccount(): Promise<void> {
    await this.run(() => this.native.openAccount(this.server));
  }
  async completeMfa(): Promise<void> {
    await this.run(async () => {
      await this.native.completeMfa(this.mfa);
      this.mfa = '';
      this.needsMfa = false;
    });
  }
  async passkey(): Promise<void> {
    await this.run(async () => {
      await this.native.passkey();
      this.needsMfa = false;
    });
  }
  async link(migrate: boolean): Promise<void> {
    await this.run(() => this.native.link(migrate));
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
    await this.run(() => this.native.deleteAccount());
  }
  async runSignOut(): Promise<void> {
    await this.run(() => this.native.logout());
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
