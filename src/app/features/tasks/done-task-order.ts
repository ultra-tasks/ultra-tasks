import { Task } from './task.model';

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const MAX_DATE = 8_640_000_000_000_000;

// A fixed-width inverted timestamp keeps unmodified tasks newest-first. The
// encoded id makes equal timestamps deterministic, including across devices.
const idSuffix = (id: string): string =>
  Array.from(id, (char) => char.codePointAt(0)!.toString(16).padStart(6, '0')).join('') +
  'V';

// One completion gets two `doneOn` stamps: from the reducer when the task is
// completed, and from op-log capture for the persisted operation, a few
// milliseconds later. A reload that replays the log, or another device, sees the
// second one, so a saved order has to survive that gap or it is lost on reload
// and never matches across devices. A genuine second completion (reopen, then
// complete again) is told apart by being further apart than this; one that is
// closer keeps its manual place, which is harmless.
const COMPLETION_TIME_TOLERANCE_MS = 1000;

const isSameCompletion = (saved: number | null, current: number | null): boolean =>
  saved === current ||
  (saved !== null &&
    current !== null &&
    Math.abs(saved - current) < COMPLETION_TIME_TOLERANCE_MS);

export const hasManualDoneTaskOrder = (
  task: Pick<Task, 'projectId' | 'doneOn' | 'doneOrder'>,
): boolean =>
  !!task.doneOrder &&
  task.doneOrder.projectId === task.projectId &&
  isSameCompletion(task.doneOrder.doneOn, task.doneOn ?? null) &&
  /^[0-9A-Za-z]+V$/.test(task.doneOrder.key);

export const doneTaskOrderKey = (
  task: Pick<Task, 'id' | 'projectId' | 'doneOn' | 'doneOrder'>,
): string => {
  const stored = task.doneOrder;
  if (stored && hasManualDoneTaskOrder(task)) {
    return stored.key;
  }
  const timestamp = Number.isFinite(task.doneOn)
    ? Math.min(MAX_DATE, Math.max(0, Math.trunc(task.doneOn!)))
    : 0;
  return `${String(MAX_DATE - timestamp).padStart(16, '0')}V${idSuffix(task.id)}`;
};

/** Generate a stable fractional key strictly between two existing keys. */
export const doneTaskOrderBetween = (
  lower: string | null,
  upper: string | null,
  id: string,
): string => {
  if (lower !== null && upper !== null && lower >= upper)
    throw new Error('Invalid order bounds');
  let prefix = '';
  let left = lower ?? '';
  let right = upper;
  while (true) {
    const a = left ? DIGITS.indexOf(left[0]) : -1;
    const b = right === null ? DIGITS.length : right ? DIGITS.indexOf(right[0]) : -1;
    if ((left && a < 0) || (right !== null && b < 0))
      throw new Error('Invalid order key');
    if (a === b) {
      prefix += DIGITS[a];
      left = left.slice(1);
      right = right!.slice(1);
    } else if (b - a > 1) {
      return prefix + DIGITS[Math.floor((a + b) / 2)] + 'V' + idSuffix(id);
    } else if (a < 0) {
      prefix += DIGITS[0];
      right = right!.slice(1);
      left = '';
    } else {
      prefix += DIGITS[a];
      left = left.slice(1);
      right = null;
    }
  }
};

/** Manual ordering applies only within the task's project, not Today or tags. */
export const sortDoneTasksByProjectOrder = <
  T extends Pick<Task, 'id' | 'projectId' | 'doneOn' | 'doneOrder'>,
>(
  tasks: readonly T[],
): T[] =>
  tasks
    .map((task) => ({ task, key: doneTaskOrderKey(task) }))
    .sort((a, b) =>
      a.key < b.key ? -1 : a.key > b.key ? 1 : a.task.id.localeCompare(b.task.id),
    )
    .map(({ task }) => task);
