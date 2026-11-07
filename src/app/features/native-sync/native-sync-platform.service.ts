import { inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { GlobalConfigService } from '../config/global-config.service';
import { T } from '../../t.const';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { BackgroundTask } from '@capawesome/capacitor-background-task';
import { LocalNotifications } from '@capacitor/local-notifications';
import {
  nativeScopeCredentials,
  sharedReminderProjection,
  type AccountClient,
  type SyncClient,
  type Tokens,
  type Transport,
} from '@sp/sync-providers/ultra-tasks';
import { generateNotificationId } from '../android/android-notification-id.util';

interface NativeAccountPlugin {
  command(options: { method: string; input: object }): Promise<unknown>;
}
interface AndroidNativeAccount {
  nativeAccountCall(requestId: string, method: string, payload: string): void;
}
const plugin = registerPlugin<NativeAccountPlugin>('NativeAccount');
const android = (): AndroidNativeAccount | undefined =>
  (window as unknown as { SUPAndroid?: AndroidNativeAccount }).SUPAndroid
    ?.nativeAccountCall
    ? (window as unknown as { SUPAndroid: AndroidNativeAccount }).SUPAndroid
    : undefined;

/** OS-protected sessions; one refresh owner shared with the Android reminder worker. */
@Injectable({ providedIn: 'root' })
export class NativeSyncPlatformService {
  private readonly config = inject(GlobalConfigService);
  private readonly translate = inject(TranslateService);
  private bound?: AccountClient;
  private listener?: PluginListenerHandle;
  private reminders = new Map<string, number>();
  private webTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private lifecycle: Promise<void> = Promise.resolve();
  private updates: Promise<void> = Promise.resolve();
  private generation = 0;
  get supported(): boolean {
    return (
      !!android() ||
      (Capacitor.isNativePlatform() &&
        Capacitor.getPlatform() === 'ios' &&
        Capacitor.isPluginAvailable('NativeAccount'))
    );
  }
  transport(base: Transport): Transport {
    return (path, body, token, method) =>
      path === '/sessions/refresh' && this.bound
        ? this.command('refresh', this.bound.identity())
        : base(path, body, token, method);
  }
  private command(method: string, input: object): Promise<unknown> {
    const bridge = android();
    if (!bridge) return plugin.command({ method, input });
    return new Promise((resolve, reject) => {
      const requestId = crypto.randomUUID();
      const cleanup = (): void => {
        clearTimeout(timeout);
        window.removeEventListener('ultra-native-account', reply);
      };
      const reply = (event: Event): void => {
        const detail = (
          event as CustomEvent<{
            requestId: string;
            ok: boolean;
            data: unknown;
            error?: string;
          }>
        ).detail;
        if (detail.requestId !== requestId) return;
        cleanup();
        if (detail.ok) resolve(detail.data);
        else reject(new Error(detail.error ?? 'Native session unavailable'));
      };
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Native session timed out'));
      }, 60000);
      window.addEventListener('ultra-native-account', reply);
      try {
        bridge.nativeAccountCall(requestId, method, JSON.stringify(input));
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  }
  async bind(
    client: SyncClient,
    baseUrl: string,
    resume: () => Promise<void>,
    flushShared: () => Promise<void>,
    cachedRefreshToken?: string,
  ): Promise<void> {
    const account = client.account;
    if (this.supported) {
      if (account.tokens)
        await this.command('configure', {
          ...account.identity(),
          baseUrl,
          tokens: account.tokens,
          // Session refresh can bind before the explicit personal-data choice.
          // Content keys follow through update() only after that choice.
          scopes: [],
        });
      else if (cachedRefreshToken)
        await this.command('bootstrap', {
          ...account.identity(),
          baseUrl,
          refreshToken: cachedRefreshToken,
          scopes: [],
        });
      this.bound = account;
    }
    if (Capacitor.isNativePlatform())
      this.listener = await App.addListener('appStateChange', ({ isActive }) => {
        this.lifecycle = this.lifecycle
          .then(async () => {
            if (isActive) {
              await resume();
              return;
            }
            const taskId = await BackgroundTask.beforeExit(async () => {
              try {
                await flushShared();
              } finally {
                await BackgroundTask.finish({ taskId });
              }
            });
          })
          .catch(() => undefined);
      });
  }
  async current(account: AccountClient): Promise<Tokens | undefined> {
    if (!this.bound || !this.supported) return undefined;
    return this.command('current', account.identity()) as Promise<Tokens>;
  }
  async reminderBarrier(account: AccountClient): Promise<number | undefined> {
    if (!android() || !this.bound) return undefined;
    return (
      (await this.command('reminder-barrier', account.identity())) as { version: number }
    ).version;
  }
  async personalSynced(
    account: AccountClient,
    version: number | undefined,
  ): Promise<void> {
    if (version !== undefined && this.bound && android())
      await this.command('personal-synced', { ...account.identity(), version });
  }
  update(client: SyncClient): Promise<void> {
    const generation = this.generation;
    const result = this.updates.then(async () => {
      if (generation === this.generation) await this.updateProjection(client);
    });
    this.updates = result.catch(() => undefined);
    return result;
  }
  private async updateProjection(client: SyncClient): Promise<void> {
    if (this.bound && this.supported)
      await this.command('scopes', {
        ...client.account.identity(),
        scopes: nativeScopeCredentials(client),
      });
    const desired = this.config.cfg()?.reminder?.disableReminders
      ? {}
      : sharedReminderProjection(client, Date.now());
    if (this.bound && android()) {
      await this.command('local-reminders', {
        ...client.account.identity(),
        reminders: desired,
      });
      return;
    }
    if (Capacitor.isNativePlatform()) {
      const cancelled = [...this.reminders]
        .filter(([id, time]) => desired[id]?.remindAt !== time)
        .map(([id]) => ({ id: generateNotificationId(id) }));
      if (cancelled.length) await LocalNotifications.cancel({ notifications: cancelled });
      const changed = Object.entries(desired).filter(
        ([id, item]) => this.reminders.get(id) !== item.remindAt,
      );
      if (changed.length)
        await LocalNotifications.schedule({
          notifications: changed.map(([id, item]) => ({
            id: generateNotificationId(id),
            title: item.title,
            body: this.translate.instant(T.NATIVE_SYNC.SHARED_REMINDER),
            schedule: { at: new Date(item.remindAt) },
            extra: { relatedId: id, reminderType: 'NATIVE_SHARED' },
          })),
        });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      for (const [id, timer] of this.webTimers)
        if (!desired[id] || desired[id].remindAt !== this.reminders.get(id)) {
          clearTimeout(timer);
          this.webTimers.delete(id);
        }
      for (const [id, item] of Object.entries(desired))
        if (this.reminders.get(id) !== item.remindAt) {
          const delay = item.remindAt - Date.now();
          if (delay <= 2147483647)
            this.webTimers.set(
              id,
              setTimeout(() => {
                new Notification(item.title);
                this.webTimers.delete(id);
              }, delay),
            );
        }
    }
    this.reminders = new Map(
      Object.entries(desired).map(([id, item]) => [id, item.remindAt]),
    );
  }
  async requestReminderPermission(): Promise<void> {
    if (Capacitor.isNativePlatform()) await LocalNotifications.requestPermissions();
    else if ('Notification' in window && Notification.permission === 'default')
      await Notification.requestPermission();
  }
  async clear(): Promise<Tokens | undefined> {
    this.generation++;
    await this.updates;
    await this.listener?.remove();
    this.listener = undefined;
    const account = this.bound;
    this.bound = undefined;
    for (const timer of this.webTimers.values()) clearTimeout(timer);
    this.webTimers.clear();
    if (Capacitor.isNativePlatform() && !android() && this.reminders.size)
      await LocalNotifications.cancel({
        notifications: [...this.reminders.keys()].map((id) => ({
          id: generateNotificationId(id),
        })),
      });
    this.reminders.clear();
    if (this.supported) {
      if (account?.unlocked)
        return this.command('detach', account.identity()) as Promise<Tokens>;
      await this.command('clear', {});
    }
    return undefined;
  }
}
