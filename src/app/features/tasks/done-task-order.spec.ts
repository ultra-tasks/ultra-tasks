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
