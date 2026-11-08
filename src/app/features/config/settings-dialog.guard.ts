import { inject } from '@angular/core';
import { CanActivateFn, NavigationEnd, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TranslateService } from '@ngx-translate/core';
import { filter, take } from 'rxjs/operators';
import { T } from '../../t.const';
import { dialogSize } from '../../ui/dialog-size.util';

/** Keep the current workspace mounted underneath settings, including shortcut entry. */
export const settingsDialogGuard: CanActivateFn = async (route) => {
  const router = inject(Router);
  const dialogs = inject(MatDialog);
  const translate = inject(TranslateService);
  const isPlugins = route.data['plugins'] || route.queryParams['tab'] === '4';
  const isAccount = !!route.data['account'];
  const id = isPlugins
    ? 'plugins-window'
    : isAccount
      ? 'account-window'
      : 'settings-window';
  const { ConfigPageComponent } =
    await import('../../pages/config-page/config-page.component');
  const { PluginsWindowComponent } =
    await import('../../plugins/ui/plugins-window.component');
  const open = (): void => {
    if (dialogs.getDialogById(id)) return;
    dialogs.open<unknown>(isPlugins ? PluginsWindowComponent : ConfigPageComponent, {
      id,
      ...dialogSize('window', 'settings-window'),
      height: '86dvh',
      maxHeight: '96dvh',
      backdropClass: 'settings-backdrop',
      autoFocus: 'first-heading',
      restoreFocus: true,
      ariaLabel: translate.instant(
        isPlugins
          ? T.PLUGINS.MARKETPLACE
          : isAccount
            ? T.PS.REFINEMENT.ACCOUNT
            : T.PS.GLOBAL_SETTINGS,
      ),
      data: isAccount
        ? { ...route.queryParams, account: 'true', tab: '9' }
        : route.queryParams,
    });
  };
  if (!router.navigated) {
    // A bookmarked URL needs a workspace behind the dialog before it opens.
    router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        take(1),
      )
      .subscribe(open);
    return router.parseUrl('/active/tasks');
  }
  open();
  return false;
};
