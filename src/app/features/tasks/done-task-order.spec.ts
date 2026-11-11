import {
  doneTaskOrderBetween,
  doneTaskOrderKey,
  hasManualDoneTaskOrder,
  sortDoneTasksByProjectOrder,
} from './done-task-order';
import { Task } from './task.model';

describe('completed task project ordering', () => {
  const task = (
    id: string,
    doneOn: number,
  ): Pick<Task, 'id' | 'projectId' | 'doneOn' | 'doneOrder'> => ({
    id,
    projectId: 'p',
    doneOn,
    doneOrder: null,
  });

  it('keeps chronological order until a task is manually repositioned', () => {
    const older = task('older', 1000);
    const newer = task('newer', 2000);
    expect(sortDoneTasksByProjectOrder([older, newer])).toEqual([newer, older]);
    const moved = {
      ...newer,
      doneOrder: {
        projectId: 'p',
        doneOn: 2000,
        key: doneTaskOrderBetween(doneTaskOrderKey(older), null, 'newer'),
      },
    };
    expect(sortDoneTasksByProjectOrder([older, moved])).toEqual([older, moved]);
    expect(moved.doneOn).toBe(2000);
  });

  it('ignores an order from an earlier completion or another project', () => {
    const moved = {
      ...task('one', 2000),
      doneOrder: { projectId: 'p', doneOn: 2000, key: 'zV' },
    };
    expect(hasManualDoneTaskOrder(moved)).toBeTrue();
    expect(hasManualDoneTaskOrder({ ...moved, doneOn: 3000 })).toBeFalse();
    expect(hasManualDoneTaskOrder({ ...moved, projectId: 'other' })).toBeFalse();
  });

  it('keeps an order across the few milliseconds between the live and replayed completion time', () => {
    // The reducer and op-log capture each stamp doneOn, so a reload that replays
    // the log sees a slightly later value than the one the order was saved with.
    const moved = {
      ...task('one', 2000),
      doneOrder: { projectId: 'p', doneOn: 2000, key: 'zV' },
    };
    expect(hasManualDoneTaskOrder({ ...moved, doneOn: 2002 })).toBeTrue();
    expect(hasManualDoneTaskOrder({ ...moved, doneOn: 2010 })).toBeTrue();
    expect(hasManualDoneTaskOrder({ ...moved, doneOn: 1990 })).toBeTrue();
    expect(hasManualDoneTaskOrder({ ...moved, doneOn: 2999 })).toBeTrue();
  });

  it('still drops an order once the task was completed a second or more later', () => {
    const moved = {
      ...task('one', 2000),
      doneOrder: { projectId: 'p', doneOn: 2000, key: 'zV' },
    };
    expect(hasManualDoneTaskOrder({ ...moved, doneOn: 3000 })).toBeFalse();
    expect(hasManualDoneTaskOrder({ ...moved, doneOn: 1000 })).toBeFalse();
    expect(hasManualDoneTaskOrder({ ...moved, doneOn: 60_000 })).toBeFalse();
  });

  it('does not treat a missing completion time as the saved one', () => {
    const saved = { projectId: 'p', doneOn: 2000, key: 'zV' };
    expect(
      hasManualDoneTaskOrder({
        projectId: 'p',
        doneOn: undefined,
        doneOrder: saved,
      }),
    ).toBeFalse();
    expect(
      hasManualDoneTaskOrder({
        projectId: 'p',
        doneOn: undefined,
        doneOrder: { ...saved, doneOn: null },
      }),
    ).toBeTrue();
  });

  it('keeps the manual position when the replayed completion time differs slightly', () => {
    const older = task('older', 1000);
    const newer = task('newer', 2000);
    const moved = {
      ...newer,
      doneOn: 2007,
      doneOrder: {
        projectId: 'p',
        doneOn: 2000,
        key: doneTaskOrderBetween(doneTaskOrderKey(older), null, 'newer'),
      },
    };
    expect(sortDoneTasksByProjectOrder([older, moved])).toEqual([older, moved]);
  });

  it('orders tasks from a client that does not know the field by completion time', () => {
    // A released client never writes doneOrder, so the key is absent rather than null.
    const older = { id: 'older', projectId: 'p', doneOn: 1000 } as Task;
    const newer = { id: 'newer', projectId: 'p', doneOn: 2000 } as Task;

    expect(hasManualDoneTaskOrder(older)).toBeFalse();
    expect(sortDoneTasksByProjectOrder([older, newer])).toEqual([newer, older]);
  });

  it('treats a malformed order from another client as no manual order', () => {
    const base = { id: 'one', projectId: 'p', doneOn: 1000 };
    const malformed: unknown[] = [
      'aV',
      42,
      [],
      {},
      { projectId: 'p', doneOn: 1000 },
      { projectId: 'p', doneOn: 1000, key: 5 },
      { projectId: 'p', doneOn: 1000, key: 'no-suffix-marker' },
      { projectId: 'p', doneOn: 1000, key: '' },
    ];

    for (const doneOrder of malformed) {
      const received = { ...base, doneOrder } as unknown as Task;
      expect(hasManualDoneTaskOrder(received))
        .withContext(JSON.stringify(doneOrder))
        .toBeFalse();
      expect(doneTaskOrderKey(received)).toBe(
        doneTaskOrderKey({ ...base, doneOrder: null } as Task),
      );
    }
  });

  it('can repeatedly insert before, after, and between keys', () => {
    const keys: string[] = [];
    let random = 9341;
    for (let i = 0; i < 1500; i++) {
      random = (random * 48271) % 2147483647;
      const index = random % (keys.length + 1);
      const before = keys[index - 1] ?? null;
      const after = keys[index] ?? null;
      const key = doneTaskOrderBetween(before, after, `task-${i}`);
      if (before !== null) expect(key > before).toBeTrue();
      if (after !== null) expect(key < after).toBeTrue();
      keys.splice(index, 0, key);
    }
    expect(new Set(keys).size).toBe(1500);
  });
});
