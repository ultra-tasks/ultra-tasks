import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { PlannerActions } from './planner.actions';
import { filter, tap } from 'rxjs/operators';
import { SnackService } from '../../../core/snack/snack.service';
import { T } from 'src/app/t.const';
import { PlannerService } from '../planner.service';
import { LocaleDatePipe } from 'src/app/ui/pipes/locale-date.pipe';
import { TranslateService } from '@ngx-translate/core';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TaskPlanUndoService } from '../../tasks/task-plan-undo.service';

@Injectable()
export class PlannerEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _snackService = inject(SnackService);
  private _plannerService = inject(PlannerService);
  private _datePipe = inject(LocaleDatePipe);
  private _translateService = inject(TranslateService);
  private _taskPlanUndo = inject(TaskPlanUndoService);

  planForDaySnack$ = createEffect(
    () => {
      return this._actions$.pipe(
        ofType(PlannerActions.planTaskForDay),
        filter((action) => !!action.isShowSnack),
        tap(async (action) => {
          const isForToday = action.day === getDbDateStr();
          const formattedDate = isForToday
            ? this._translateService.instant(T.G.TODAY_TAG_TITLE)
            : (this._datePipe.transform(action.day, 'shortDate') as string);

          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.PLANNER.S.TASK_PLANNED_FOR,
            ico: 'today',
            translateParams: {
              date: formattedDate,
              extra: await this._plannerService.getSnackExtraStr(action.day),
            },
            // Undo where the plan can be put back exactly (a plain, unscheduled task)
            ...this._taskPlanUndo.getSnackAction(action.task, action.day),
          });
        }),
      );
    },
    { dispatch: false },
  );
}
