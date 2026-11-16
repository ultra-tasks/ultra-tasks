import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  signal,
  untracked,
} from '@angular/core';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { IS_SYNC_AVAILABLE } from '../../app.constants';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { HydrationStateService } from '../../op-log/apply/hydration-state.service';
import { NativeSyncService } from '../native-sync/native-sync.service';
import { selectAllTasks } from '../tasks/store/task.selectors';
import { Task } from '../tasks/task.model';
import { createIntegrationCalendar } from './integration-calendar';
import { fromEvent } from 'rxjs';

export interface PublishedCalendar {
  id: string;
  label: string;
  privacy: 'busy' | 'titles';
  revision: number;
  generation: number;
}
export interface CalendarSelection {
  type: 'all' | 'project' | 'tag';
  id?: string;
}
interface OwnedCalendar extends PublishedCalendar {
  selection: CalendarSelection;
}
interface CreatedCalendar extends PublishedCalendar {
  url: string;
}
const DAY = 86400000;
const PAST_WINDOW = 30 * DAY;
const FUTURE_WINDOW = 180 * DAY;

const sameCalendarTasks = (previous: Task[], next: Task[]): boolean =>
  previous.length === next.length &&
  previous.every((task, index) => {
    const other = next[index];
    return (
      task === other ||
      (task.id === other.id &&
        task.title === other.title &&
        task.dueDay === other.dueDay &&
        task.dueWithTime === other.dueWithTime &&
        task.timeEstimate === other.timeEstimate &&
        task.isDone === other.isDone &&
        task.projectId === other.projectId &&
        (task.tagIds === other.tagIds ||
          (task.tagIds.length === other.tagIds.length &&
            task.tagIds.every((id, tagIndex) => id === other.tagIds[tagIndex]))))
    );
  });

/** Device-local publishing ownership; no publication or secret enters synced state. */
@Injectable({ providedIn: 'root' })
export class CalendarPublicationService {
  private readonly _native = inject(NativeSyncService);
  private readonly _taskState = inject(Store).selectSignal(selectAllTasks);
  private readonly _tasks = computed(() => this._taskState(), {
    equal: sameCalendarTasks,
  });
  private readonly _ready = toSignal(
    inject(DataInitStateService).isAllDataLoadedInitially$,
    { initialValue: false },
  );
  private readonly _hydration = inject(HydrationStateService);
  private readonly _owned = signal<OwnedCalendar[]>([]);
  private _key = '';
  private _queue: Promise<unknown> = Promise.resolve();
  private _timer?: ReturnType<typeof setTimeout>;
  private _retryTimer?: ReturnType<typeof setTimeout>;
  private readonly _onlineEvent = toSignal(fromEvent(window, 'online'));
  private readonly _publicationDue = signal(false);
  private readonly _lastBodies = new Map<string, string>();
  readonly feeds = signal<PublishedCalendar[]>([]);
  readonly available = signal(false);
  readonly error = signal(false);
  readonly busy = signal(false);
  readonly ownedIds = computed(() => new Set(this._owned().map((feed) => feed.id)));

  constructor() {
    inject(DestroyRef).onDestroy(() => this._cancelScheduledPublication());
    effect(() => {
      const unlocked = this._native.unlocked();
      const linked = this._native.linked();
      if (!IS_SYNC_AVAILABLE || !unlocked || !linked) {
        this.available.set(false);
        this.feeds.set([]);
        this._key = '';
        this._owned.set([]);
        this._lastBodies.clear();
        return;
      }
      const key = this._storageKey();
      if (key !== this._key) {
        this._key = key;
        untracked(() => this._loadOwned());
        void this.refresh();
      }
    });
    effect(() => {
      if (!this._ready() || !this._native.unlocked() || !this._native.linked()) {
        this._cancelScheduledPublication();
        return;
      }
      this._tasks();
      this._onlineEvent();
      if (!this._owned().length) {
        this._cancelScheduledPublication();
        return;
      }
      // A bounded audit window, not a quiet-period debounce: regular sync and
      // tracking activity must not postpone a calendar change indefinitely.
      if (!this._timer && !untracked(this._publicationDue)) {
        this._timer = setTimeout(() => {
          this._timer = undefined;
          this._publicationDue.set(true);
        }, 2000);
      }
    });
    effect(() => {
      if (
        !this._publicationDue() ||
        this._native.busy() ||
        this._hydration.isInSyncWindow()
      )
        return;
      const account = this._native.account;
      const key = this._key;
      this._publicationDue.set(false);
      void this._serial(async () => {
        if (
          key !== this._key ||
          account !== this._native.account ||
          !this._native.unlocked()
        )
          return;
        // Read when this serialized write starts, so a slow earlier upload
        // cannot leave a queued publication using its old revision.
        const tasks = this._tasks();
        const owned = this._owned();
        for (const feed of owned) {
          const comparison = this._calendar(tasks, feed, 0, 0);
          if (this._lastBodies.get(feed.id) === comparison) continue;
          const next = await account!.request<PublishedCalendar>(
            `/calendar-feeds/${feed.id}`,
            {
              body: this._calendar(tasks, feed, feed.revision + 1, Date.now()),
              revision: feed.revision + 1,
              generation: feed.generation,
            },
            'PUT',
          );
          if (key !== this._key) return;
          this._saveOwned(
            this._owned().map((existing) =>
              existing.id === feed.id ? { ...existing, ...next } : existing,
            ),
          );
          this._lastBodies.set(feed.id, comparison);
        }
        this.error.set(false);
        if (this._retryTimer !== undefined) clearTimeout(this._retryTimer);
        this._retryTimer = undefined;
      }).catch((error: unknown) => {
        if (key !== this._key) return;
        this.error.set(true);
        const status =
          error && typeof error === 'object' && 'status' in error
            ? error.status
            : undefined;
        // Conflicts need a reload/decision. Transport and server failures can
        // retry quietly; an online event also schedules an earlier attempt.
        if (typeof status === 'number' && status < 500) return;
        if (this._retryTimer === undefined) {
          this._retryTimer = setTimeout(() => {
            this._retryTimer = undefined;
            if (key === this._key) this._publicationDue.set(true);
          }, 60000);
        }
      });
    });
  }

  private _cancelScheduledPublication(): void {
    if (this._timer !== undefined) clearTimeout(this._timer);
    if (this._retryTimer !== undefined) clearTimeout(this._retryTimer);
    this._timer = undefined;
    this._retryTimer = undefined;
    this._publicationDue.set(false);
  }

  async refresh(): Promise<void> {
    const account = this._native.account;
    const key = this._key;
    if (!account || !key) return;
    const beforeOwned = this._owned();
    try {
      const response = await account.request<{ feeds: PublishedCalendar[] }>(
        '/calendar-feeds',
      );
      if (key !== this._key) return;
      this.feeds.set(response.feeds);
      this.available.set(true);
      // Dashboard rotation changes only the generation. Keep this device's
      // selection, but never adopt a different writer's content revision.
      const owned = this._owned();
      const updated = owned.flatMap((feed) => {
        const remote = response.feeds.find((entry) => entry.id === feed.id);
        return remote
          ? [
              {
                ...feed,
                generation:
                  remote.revision === feed.revision ? remote.generation : feed.generation,
              },
            ]
          : [];
      });
      if (owned === beforeOwned && JSON.stringify(updated) !== JSON.stringify(owned))
        this._saveOwned(updated);
      this.error.set(false);
    } catch {
      if (key === this._key) this.available.set(false);
    }
  }

  async create(
    label: string,
    privacy: 'busy' | 'titles',
    selection: CalendarSelection,
  ): Promise<string> {
    return this._serial(async () => {
      const account = this._native.account!;
      const key = this._key;
      const draft = { privacy, selection };
      const created = await account.request<CreatedCalendar>('/calendar-feeds', {
        label,
        privacy,
        consent: true,
        body: this._calendar(this._tasks(), draft, 0, Date.now()),
      });
      try {
        if (key !== this._key) throw new Error('Account changed');
        this._saveOwned([...this._owned(), { ...created, selection }]);
      } catch (error) {
        await account.request(`/calendar-feeds/${created.id}`, undefined, 'DELETE');
        throw error;
      }
      this._lastBodies.set(created.id, this._calendar(this._tasks(), draft, 0, 0));
      await this.refresh();
      return created.url;
    });
  }

  async rotate(feed: PublishedCalendar): Promise<string> {
    return this._serial(async () => {
      const key = this._key;
      const rotated = await this._native.account!.request<CreatedCalendar>(
        `/calendar-feeds/${feed.id}/rotate`,
        {},
      );
      if (key !== this._key) throw new Error('Account changed');
      this._saveOwned(
        this._owned().map((existing) =>
          existing.id === feed.id ? { ...existing, ...rotated } : existing,
        ),
      );
      await this.refresh();
      return rotated.url;
    });
  }

  async stop(feed: PublishedCalendar): Promise<void> {
    return this._serial(async () => {
      const key = this._key;
      await this._native.account!.request(
        `/calendar-feeds/${feed.id}`,
        undefined,
        'DELETE',
      );
      if (key !== this._key) return;
      this._saveOwned(this._owned().filter((existing) => existing.id !== feed.id));
      this._lastBodies.delete(feed.id);
      await this.refresh();
    });
  }

  private _calendar(
    tasks: Task[],
    feed: Pick<OwnedCalendar, 'privacy' | 'selection'>,
    revision: number,
    updatedAt: number,
  ): string {
    const selected = tasks.filter(
      (task) =>
        feed.selection.type === 'all' ||
        (feed.selection.type === 'project'
          ? task.projectId === feed.selection.id
          : task.tagIds.includes(feed.selection.id ?? '')),
    );
    const now = Date.now();
    return createIntegrationCalendar(selected, {
      privacy: feed.privacy,
      revision,
      updatedAt,
      windowStart: now - PAST_WINDOW,
      windowEnd: now + FUTURE_WINDOW,
    });
  }

  private _storageKey(): string {
    return `ultra-calendar-publications:${this._native.serverUrl}:${this._native.account!.identity().accountId}`;
  }
  private _loadOwned(): void {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(this._key) ?? '[]');
      this._owned.set(
        Array.isArray(value)
          ? value.filter(
              (entry): entry is OwnedCalendar =>
                !!entry &&
                typeof entry.id === 'string' &&
                typeof entry.revision === 'number' &&
                typeof entry.generation === 'number' &&
                !!entry.selection &&
                ['all', 'project', 'tag'].includes(entry.selection.type) &&
                ['busy', 'titles'].includes(entry.privacy),
            )
          : [],
      );
    } catch {
      this._owned.set([]);
      this.error.set(true);
    }
  }
  private _saveOwned(feeds: OwnedCalendar[]): void {
    // Only metadata and selection persist; URLs are shown once, never stored.
    const stored = feeds.map(
      ({ id, label, privacy, revision, generation, selection }) => ({
        id,
        label,
        privacy,
        revision,
        generation,
        selection,
      }),
    );
    localStorage.setItem(this._key, JSON.stringify(stored));
    this._owned.set(stored);
  }
  private _serial<T>(run: () => Promise<T>): Promise<T> {
    const key = this._key;
    const account = this._native.account;
    const result = this._queue.then(async () => {
      if (
        !key ||
        key !== this._key ||
        account !== this._native.account ||
        !this._native.unlocked()
      ) {
        throw new Error('Account changed');
      }
      this.busy.set(true);
      try {
        return await run();
      } finally {
        this.busy.set(false);
      }
    });
    this._queue = result.catch(() => undefined);
    return result;
  }
}
