import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIcon } from '@angular/material/icon';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../t.const';
import { isTouchActive } from '../../util/input-intent';

let nextCardId = 0;

/**
 * Shared help affordance for settings rows and custom controls.
 *
 * With a mouse or keyboard the "?" button shows the help as a tooltip (hover,
 * focus, click). A touch screen has no hover to hold a tooltip open, so there a
 * tap toggles the same text as a card under the row: it stays until the next
 * tap and needs no timer, however long the text is. The host takes no box
 * (`display: contents`) so the card can span the whole row, see `.setting-row`
 * and `.setting-help-card` in `styles/components/_settings.scss`.
 */
@Component({
  selector: 'setting-help',
  imports: [MatTooltip, MatIcon, TranslatePipe],
  template: `
    <button
      type="button"
      class="setting-help-button"
      [matTooltip]="plainText()"
      [matTooltipDisabled]="isTouch()"
      #tooltip="matTooltip"
      matTooltipPosition="above"
      [matTooltipHideDelay]="120"
      [attr.aria-expanded]="isTouch() ? isOpen() : null"
      [attr.aria-controls]="isTouch() && isOpen() ? cardId : null"
      (click)="onClick(tooltip, $event)"
      [attr.aria-label]="(T.PS.REDESIGN.HELP | translate) + ' — ' + label()"
    >
      <mat-icon aria-hidden="true">help_outline</mat-icon>
    </button>
    @if (isOpen()) {
      <p
        class="setting-help-card"
        [id]="cardId"
      >
        {{ plainText() }}
      </p>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingHelpComponent {
  readonly T = T;
  readonly text = input.required<string>();
  readonly label = input.required<string>();

  /** The current input is a finger (a phone, or a touch tap on a hybrid laptop). */
  readonly isTouch = isTouchActive;
  /** Touch only: the help card under the row is shown. */
  readonly isOpen = signal(false);
  readonly cardId = `setting-help-card-${nextCardId++}`;

  readonly plainText = computed(() =>
    this.text()
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim(),
  );

  onClick(tooltip: MatTooltip, event: MouseEvent): void {
    event.stopPropagation();
    if (this.isTouch() || (event as PointerEvent).pointerType === 'touch') {
      // The tooltip cannot serve a tap: `show()` followed by `hide()` in the same
      // tick detached it before it was visible, and a 2.5s timer is shorter than
      // the longest help texts (667 characters). A card has neither problem.
      this.isOpen.update((isOpen) => !isOpen);
      return;
    }
    tooltip.show();
  }
}
