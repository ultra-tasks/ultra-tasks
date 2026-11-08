import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
} from '@angular/core';
import { MatDialogClose, MatDialogRef } from '@angular/material/dialog';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs/operators';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { PluginManagementComponent } from './plugin-management/plugin-management.component';
import { T } from '../../t.const';

@Component({
  selector: 'plugins-window',
  imports: [
    MatDialogClose,
    MatIconButton,
    MatIcon,
    TranslatePipe,
    PluginManagementComponent,
  ],
  template: `
    <header class="settings-window-header">
      <h1>{{ T.PLUGINS.MARKETPLACE | translate }}</h1>
      <button
        mat-icon-button
        mat-dialog-close
        [aria-label]="T.G.CLOSE | translate"
      >
        <mat-icon>close</mat-icon>
      </button>
    </header>
    <div class="plugins-window-content"><plugin-management /></div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .plugins-window-content {
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PluginsWindowComponent implements OnInit {
  readonly T = T;
  private readonly _dialog = inject(MatDialogRef);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  ngOnInit(): void {
    this._router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe(() => this._dialog.close());
  }
}
