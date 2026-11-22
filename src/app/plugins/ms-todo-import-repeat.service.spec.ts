import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
} from '../features/task-repeat-cfg/task-repeat-cfg.model';
import { TaskRepeatCfgService } from '../features/task-repeat-cfg/task-repeat-cfg.service';
import { DEFAULT_TASK, Task } from '../features/tasks/task.model';
import { TaskService } from '../features/tasks/task.service';
import { MsTodoImportRepeatService } from './ms-todo-import-repeat.service';

describe('MsTodoImportRepeatService', () => {
  let service: MsTodoImportRepeatService;
  let tasks: jasmine.SpyObj<TaskService>;
  let addRepeat: jasmine.Spy<TaskRepeatCfgService['addTaskRepeatCfgToTask']>;
  const task: Task = {
    ...DEFAULT_TASK,
    id: 'imported',
    title: 'Imported task',
    projectId: 'project',
    dueDay: '2026-12-01',
    subTaskIds: ['step'],
    tagIds: ['imported-tag'],
  };

  beforeEach(() => {
    tasks = jasmine.createSpyObj<TaskService>('TaskService', ['getByIdOnce$']);
    tasks.getByIdOnce$.and.returnValue(of(task));
    addRepeat = jasmine.createSpy('addTaskRepeatCfgToTask').and.returnValue('repeat');
    const repeat: TaskRepeatCfg = { ...DEFAULT_TASK_REPEAT_CFG, id: 'repeat' };
    TestBed.configureTestingModule({
      providers: [
        { provide: TaskService, useValue: tasks },
        {
          provide: TaskRepeatCfgService,
          useValue: { addTaskRepeatCfgToTask: addRepeat, taskRepeatCfgs$: of([repeat]) },
        },
      ],
    });
    service = TestBed.inject(MsTodoImportRepeatService);
  });

  it('preserves only the chosen weekdays over the host defaults', async () => {
    await expectAsync(
      service.add(task.id, {
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        tuesday: true,
        repeatUntilDay: '2027-01-01',
      }),
    ).toBeResolvedTo('repeat');
    expect(addRepeat).toHaveBeenCalledOnceWith(
      task.id,
      task.projectId,
      jasmine.objectContaining({
        title: task.title,
        startDate: task.dueDay,
        repeatUntilDay: '2027-01-01',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        sunday: false,
        monday: false,
        tuesday: true,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: false,
        shouldInheritSubtasks: true,
        tagIds: ['imported-tag'],
      }),
    );
  });

  it('rejects an incompatible rule or an existing repeat without writing', async () => {
    await expectAsync(
      service.add(task.id, { quickSetting: 'DAILY', repeatUntilDay: '2026-11-30' }),
    ).toBeRejectedWithError('Invalid end date for this repeat.');
    tasks.getByIdOnce$.and.returnValue(of({ ...task, repeatCfgId: 'already-present' }));
    await expectAsync(
      service.add(task.id, { quickSetting: 'DAILY' }),
    ).toBeRejectedWithError('This imported task cannot repeat.');
    expect(addRepeat).not.toHaveBeenCalled();
  });
});
