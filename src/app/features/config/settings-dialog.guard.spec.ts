import { TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogState } from '@angular/material/dialog';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { Subject } from 'rxjs';
import { settingsDialogGuard } from './settings-dialog.guard';

describe('settingsDialogGuard', () => {
  for (const superseded of [false, true]) {
    it(`handles a closing dialog when navigation is ${superseded ? 'superseded' : 'still current'}`, async () => {
      const closed = new Subject<void>();
      const closingDialog = {
        getState: () => MatDialogState.CLOSING,
        afterClosed: jasmine.createSpy('afterClosed'),
      };
      const waitingForClose = new Promise<boolean>((resolve) => {
        closingDialog.afterClosed.and.callFake(() => {
          resolve(true);
          return closed.asObservable();
        });
      });
      const dialogs = {
        getDialogById: jasmine.createSpy('getDialogById').and.returnValue(closingDialog),
        open: jasmine.createSpy('open'),
      };
      const router = {
        navigated: true,
        currentNavigation: jasmine
          .createSpy('currentNavigation')
          .and.returnValue({ id: 1 }),
      };
      TestBed.configureTestingModule({
        providers: [
          { provide: Router, useValue: router },
          { provide: MatDialog, useValue: dialogs },
          { provide: TranslateService, useValue: { instant: (key: string) => key } },
        ],
      });

      const route = jasmine.createSpyObj<ActivatedRouteSnapshot>(
        'ActivatedRouteSnapshot',
        [],
        { data: {}, queryParams: { section: 'appFeatures' } },
      );
      const outcome = Promise.resolve(
        TestBed.runInInjectionContext(() =>
          settingsDialogGuard(route, {} as RouterStateSnapshot),
        ),
      );
      await expectAsync(Promise.race([waitingForClose, outcome])).toBeResolvedTo(true);
      expect(dialogs.open).not.toHaveBeenCalled();

      dialogs.getDialogById.and.returnValue(undefined);
      if (superseded) router.currentNavigation.and.returnValue({ id: 2 });
      closed.next();
      await expectAsync(outcome).toBeResolvedTo(false);

      if (superseded) {
        expect(dialogs.open).not.toHaveBeenCalled();
      } else {
        expect(dialogs.open).toHaveBeenCalledOnceWith(
          jasmine.any(Function),
          jasmine.objectContaining({ id: 'settings-window', data: route.queryParams }),
        );
      }
    });
  }
});
