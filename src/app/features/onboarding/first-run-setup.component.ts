import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe } from '@ngx-translate/core';
import { GlobalThemeService } from '../../core/theme/global-theme.service';
import { T } from '../../t.const';

export type FirstRunChoice = 'fresh' | 'restore' | 'import' | 'skip';

@Component({
  selector: 'first-run-setup',
  templateUrl: './first-run-setup.component.html',
  styleUrl: './first-run-setup.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, TranslatePipe],
})
export class FirstRunSetupComponent {
  readonly T = T;
  readonly theme = inject(GlobalThemeService);
  readonly selected = signal<Exclude<FirstRunChoice, 'skip'>>('fresh');
  private readonly _dialogRef = inject(MatDialogRef<FirstRunSetupComponent>);

  setAppearance(event: Event): void {
    const value = (event.target as HTMLSelectElement).value;
    if (value === 'system' || value === 'light' || value === 'dark') {
      this.theme.darkMode.set(value);
    }
  }

  finish(choice: FirstRunChoice): void {
    this._dialogRef.close(choice);
  }
}
