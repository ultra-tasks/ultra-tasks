import { expect, test, type Page, type Response, type Route } from '@playwright/test';
import { createSimulatedClient } from '../../utils/supersync-helpers';
import {
  addLocalTask,
  closeDevices,
  connectFirstDevice,
  engineCall,
  engineView,
  newDevice,
  signIn,
  taskTitles,
  ultraUrl,
  useAccountAppBundle,
} from './native-account-helpers';

const ACCOUNT_API = '**/api/v2/accounts/**';
const REQUEST_LIMIT = 8 * 1024 * 1024;
const SEED_TASK = 'Seed for portable notes';
const FOLLOWUP_TASK = 'Task entered after the large upload';
const NOTE_PREFIX = 'Meeting notes ';
// Each note is individually allowed. UTF-8 and ciphertext encoding put the combined
// transaction over 8 MiB even though there are fewer than 100 records.
const NOTES = Array.from({ length: 24 }, (_, index) => ({
  title: `${NOTE_PREFIX}${index + 1}`,
  notes: `${index + 1}\n${'週次会議の議事録と次回の作業予定。'.repeat(6500)}`.slice(
    0,
    100_000,
  ),
}));

const editNotes = (page: Page, write = false, checkFollowup = false): Promise<number> =>
  page.evaluate(
    async ({ entries, seedTitle, writeNotes, followup }) => {
      type Task = { id: string; projectId: string; title: string; notes: string };
      type State = {
        tasks: { entities: Record<string, Task> };
        projects: {
          entities: Record<string, { taskIds: string[]; backlogTaskIds: string[] }>;
        };
      };
      const { store, flushPendingWrites } = (
        window as unknown as {
          __e2eTestHelpers: {
            store: {
              subscribe: (next: (state: State) => void) => { unsubscribe: () => void };
              dispatch: (action: unknown) => void;
            };
            flushPendingWrites: () => Promise<void>;
          };
        }
      ).__e2eTestHelpers;
      let state!: State;
      store.subscribe((current) => (state = current)).unsubscribe();
      if (writeNotes) {
        const seed = Object.values(state.tasks.entities).find(
          (task) => task.title === seedTitle,
        );
        if (!seed) throw new Error('Missing task template');
        // Dispatch the same persistent actions as adding tasks in the app. All edits are
        // made in one local session before the background sync can capture them.
        for (const entry of entries) {
          const id = crypto.randomUUID();
          store.dispatch({
            type: '[Task Shared] addTask',
            task: { ...seed, ...entry, id },
            workContextId: seed.projectId,
            workContextType: 'PROJECT',
            isAddToBacklog: false,
            isAddToBottom: true,
            isIgnoreShortSyntax: true,
            meta: { isPersistent: true, entityType: 'TASK', entityId: id, opType: 'CRT' },
          });
        }
        await flushPendingWrites();
        store.subscribe((current) => (state = current)).unsubscribe();
      }
      const tasks = new Map(
        Object.values(state.tasks.entities).map((task) => [task.title, task]),
      );
      const isInProject = (task?: Task): boolean => {
        if (!task) return false;
        const project = state.projects.entities[task.projectId];
        return (
          !!project &&
          (project.taskIds.includes(task.id) || project.backlogTaskIds.includes(task.id))
        );
      };
      if (followup && !isInProject(tasks.get(followup))) return 0;
      return entries.filter(({ title, notes }) => {
        const task = tasks.get(title);
        return task?.notes === notes && isInProject(task);
      }).length;
    },
    {
      entries: NOTES,
      seedTitle: SEED_TASK,
      writeNotes: write,
      followup: checkFollowup ? FOLLOWUP_TASK : null,
    },
  );

const disconnectSync = async (page: Page): Promise<() => Promise<void>> => {
  const abort = (route: Route): Promise<void> => route.abort('internetdisconnected');
  await page.route(ACCOUNT_API, abort);
  return () => page.unroute(ACCOUNT_API, abort);
};

const pendingUpload = (page: Page): Promise<{ id: string; bytes: number } | null> =>
  page.evaluate(() => {
    type Device = {
      state: { scopes: Record<string, { uncertain?: { mutationId: string } }> };
    };
    const client = (window as unknown as { __e2eNativeSync: { client?: Device } })
      .__e2eNativeSync.client;
    const mutation = Object.values(client?.state.scopes ?? {}).find(
      (scope) => scope.uncertain,
    )?.uncertain;
    return mutation
      ? {
          id: mutation.mutationId,
          bytes: new TextEncoder().encode(JSON.stringify(mutation)).length,
        }
      : null;
  });

for (const upgrade of [false, true]) {
  const scenario = upgrade
    ? 'recovers a saved oversized upload on upgrade and keeps subsequent edits'
    : 'uploads notes that exceed the request limit together and keeps subsequent edits';
  test(`@ultra ${scenario}`, async ({ browser }) => {
    test.setTimeout(180_000);
    const baselineDist = process.env.E2E_ULTRA_UPLOAD_BASELINE_DIST;
    test.skip(
      upgrade && !baselineDist,
      'Requires the browser build from before byte batching',
    );
    const account = upgrade ? 'personaleditbatchresume' : 'personaleditbatch';
    let restoreCurrentBundle: () => Promise<void> = async () => undefined;
    const writer = upgrade
      ? await createSimulatedClient(
          browser,
          ultraUrl(),
          'Batch writer',
          'batch-upgrade',
          {
            serviceWorkers: 'block',
            seedBeforeBoot: async (page) => {
              restoreCurrentBundle = await useAccountAppBundle(page, baselineDist!);
            },
          },
        )
      : await newDevice(browser, 'Batch writer');
    const peer = await newDevice(browser, 'Batch peer');
    const uploads: { status: number; bytes: number }[] = [];
    let receipts = 0;
    try {
      await addLocalTask(writer, SEED_TASK);
      await connectFirstDevice(writer, account);
      await signIn(peer.page, account);
      await expect
        .poll(() => taskTitles(peer.page), { timeout: 30_000 })
        .toContain(SEED_TASK);

      const reconnect = await disconnectSync(writer.page);
      expect(await editNotes(writer.page, true)).toBe(NOTES.length);
      const recordUploadResponse = (response: Response): void => {
        if (response.url().endsWith('/transactions'))
          uploads.push({
            status: response.status(),
            bytes: response.request().postDataBuffer()?.length ?? 0,
          });
        if (new URL(response.url()).pathname.endsWith('/receipt') && response.ok())
          receipts++;
      };
      if (!upgrade) {
        writer.page.on('response', recordUploadResponse);
        let heldSecondUpload = false;
        await writer.page.route('**/api/v2/accounts/**/transactions', async (route) => {
          if (!heldSecondUpload && uploads.some(({ status }) => status === 200)) {
            heldSecondUpload = true;
            // Let the peer apply the first fragment while its later task references
            // are still missing. Its temporary repair must not become an account edit.
            await engineCall(peer.page, 'syncNow');
            const received = await editNotes(peer.page);
            expect(received).toBeGreaterThan(0);
            expect(received).toBeLessThan(NOTES.length);
            await engineCall(peer.page, 'syncNow');
          }
          await route.fallback();
        });
      }
      await reconnect();
      await engineCall(writer.page, 'syncNow');
      const originalPending = await pendingUpload(writer.page);
      const uploadsBeforeFollowup = uploads.length;
      if (upgrade) {
        // Fastify may close the socket before Chromium receives the rejection. Confirm
        // the old SDK produced and retained the exact over-limit request for restart.
        expect(originalPending?.bytes ?? 0).toBeGreaterThan(REQUEST_LIMIT);
        await engineCall(peer.page, 'syncNow');
        expect(await editNotes(peer.page)).toBe(0);
      }
      await addLocalTask(writer, FOLLOWUP_TASK);
      await engineCall(writer.page, 'syncNow');
      if (upgrade) {
        expect(await pendingUpload(writer.page)).toEqual(originalPending);
        const writerUrl = writer.page.url();
        // Keep the device's stored state and stop the old renderer's retries before
        // observing requests from the upgraded app.
        await writer.page.close();
        await restoreCurrentBundle();
        writer.page = await writer.context.newPage();
        writer.page.on('response', recordUploadResponse);
        await writer.page.goto(writerUrl);
        await signIn(writer.page, account);
        await expect
          .poll(() => engineView(writer.page), { timeout: 45_000 })
          .toMatchObject({
            linked: true,
            pendingChanges: 0,
            error: '',
          });
      }
      await engineCall(peer.page, 'syncNow');

      const pendingBytes = originalPending?.bytes ?? 0;
      const diagnostics = `${pendingBytes} bytes pending, responses ${JSON.stringify(uploads)}`;
      await expect
        .poll(() => editNotes(peer.page, false, true), {
          message: `all notes should survive (${diagnostics})`,
          timeout: 30_000,
        })
        .toBe(NOTES.length);
      if (upgrade) {
        expect(receipts).toBeGreaterThan(0);
        expect(uploads.length).toBeGreaterThan(1);
      } else expect(uploadsBeforeFollowup).toBeGreaterThan(1);
      expect(
        uploads.every(
          ({ bytes, status }) => bytes > 0 && bytes <= REQUEST_LIMIT && status === 200,
        ),
        diagnostics,
      ).toBe(true);
      await expect
        .poll(() => engineView(writer.page), {
          message: 'the writer should settle after the peer applies the uploaded edits',
          timeout: 30_000,
        })
        .toMatchObject({ pendingChanges: 0, error: '' });

      for (const device of [writer, peer]) {
        await device.page.reload();
        await device.page.waitForFunction(() => '__e2eTestHelpers' in window);
        await expect
          .poll(() => editNotes(device.page, false, true), {
            message: `all notes should survive reload on ${device.clientName}`,
            timeout: 45_000,
          })
          .toBe(NOTES.length);
      }
    } finally {
      await closeDevices(writer, peer);
    }
  });
}
