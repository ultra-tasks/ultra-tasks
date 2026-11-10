import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { MatButton } from '@angular/material/button';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../t.const';
import { findKeyboardShortcutConflicts } from '../keyboard-shortcut-conflicts';

@Component({
  selector: 'keyboard-shortcut-conflicts',
  templateUrl: './keyboard-shortcut-conflicts.component.html',
  styleUrl: './keyboard-shortcut-conflicts.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButton, TranslatePipe],
})
export class KeyboardShortcutConflictsComponent {
  readonly keyboard = input<Record<string, unknown> | undefined>();
  readonly fields = input<readonly FormlyFieldConfig[] | undefined>();
  readonly save = output<Record<string, string>>();
  readonly conflicts = computed(() =>
    findKeyboardShortcutConflicts(this.keyboard(), this.fields()),
  );
  readonly T = T;

  useSuggestion(key: string): void {
    // Recompute at click time; another device or an edit can change a binding.
    const suggestion = findKeyboardShortcutConflicts(this.keyboard(), this.fields()).find(
      (conflict) => conflict.key === key,
    )?.suggested;
    if (suggestion) this.save.emit({ [key]: suggestion });
  }
}
