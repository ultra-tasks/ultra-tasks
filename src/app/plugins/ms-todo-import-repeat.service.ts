import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import typia from 'typia';
import { MsTodoRepeatSchedule } from '../../../packages/plugin-dev/ms-todo-import/src/parse/normalized-model';
import { getDefaultSkipOverdue } from '../features/task-repeat-cfg/dialog-edit-task-repeat-cfg/get-default-skip-overdue';
import { getQuickSettingUpdates } from '../features/task-repeat-cfg/dialog-edit-task-repeat-cfg/get-quick-setting-updates';
import { DEFAULT_TASK_REPEAT_CFG } from '../features/task-repeat-cfg/task-repeat-cfg.model';
import { TaskRepeatCfgService } from '../features/task-repeat-cfg/task-repeat-cfg.service';
import { getTaskPriority } from '../features/tasks/task-priority.const';
import { TaskService } from '../features/tasks/task.service';
import { dateStrToUtcDate } from '../util/date-str-to-utc-date';
import { isValidDBDateStr } from '../util/get-db-date-str';

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

@Injectable({ providedIn: 'root' })
export class MsTodoImportRepeatService {
  private readonly _tasks = inject(TaskService);
  private readonly _repeats = inject(TaskRepeatCfgService);

  async add(taskId: unknown, schedule: unknown): Promise<string> {
    if (typeof taskId !== 'string' || !typia.equals<MsTodoRepeatSchedule>(schedule)) {
      throw new Error('Invalid Microsoft To Do repeat schedule.');
    }
    const task = await firstValueFrom(this._tasks.getByIdOnce$(taskId));
    const day = task?.dueDay;
    if (
      task?.id !== taskId ||
      task.parentId ||
      task.issueId ||
      task.repeatCfgId ||
      !day ||
      day < '1000-01-01' ||
      !isValidDBDateStr(day)
    ) {
      throw new Error('This imported task cannot repeat.');
    }
    const { quickSetting, repeatUntilDay, ...custom } = schedule;
    if (
      repeatUntilDay !== undefined &&
      (!isValidDBDateStr(repeatUntilDay) || repeatUntilDay < day)
    ) {
      throw new Error('Invalid end date for this repeat.');
    }
    if (quickSetting === 'CUSTOM') {
      if (
        !custom.repeatCycle ||
        typeof custom.repeatEvery !== 'number' ||
        !Number.isInteger(custom.repeatEvery) ||
        custom.repeatEvery < 1 ||
        custom.repeatEvery > 1000 ||
        (custom.repeatCycle === 'WEEKLY' && !WEEKDAYS.some((key) => custom[key]))
      ) {
        throw new Error('Invalid custom repeat interval.');
      }
    } else if (Object.keys(custom).length) {
      throw new Error('Custom repeat fields require a custom interval.');
    }

    const cfg = {
      ...DEFAULT_TASK_REPEAT_CFG,
      startDate: day,
      ...(quickSetting === 'CUSTOM'
        ? {
            ...Object.fromEntries(WEEKDAYS.map((key) => [key, false])),
            ...custom,
          }
        : getQuickSettingUpdates(quickSetting, dateStrToUtcDate(day))),
      quickSetting,
      repeatUntilDay,
      title: task.title,
      notes: task.notes || undefined,
      tagIds: task.tagIds,
      defaultEstimate: task.timeEstimate,
      priority: getTaskPriority(task.priority),
      shouldInheritSubtasks: task.subTaskIds.length > 0,
    };
    // Reuse the ordinary one-operation task/repeat write. No new replay action or model.
    const id = this._repeats.addTaskRepeatCfgToTask(taskId, task.projectId || null, {
      ...cfg,
      skipOverdue: getDefaultSkipOverdue(cfg),
    });
    const configs = await firstValueFrom(this._repeats.taskRepeatCfgs$);
    if (!configs.some((repeat) => repeat.id === id))
      throw new Error('Repeat was not saved.');
    return id;
  }
}
