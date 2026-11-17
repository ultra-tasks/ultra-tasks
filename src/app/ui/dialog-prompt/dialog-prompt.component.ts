import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { T } from '../../t.const';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatInput } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatButton } from '@angular/material/button';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import {
  getInputHintAttributes,
  InputHintAttributes,
} from '../formly-input-hints/input-hints.util';

@Component({
  selector: 'dialog-prompt',
  templateUrl: './dialog-prompt.component.html',
  styleUrls: ['./dialog-prompt.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatFormField,
    MatLabel,
    MatInput,
    FormsModule,
    MatDialogActions,
    MatButton,
    TranslatePipe,
  ],
})
export class DialogPromptComponent {
  private _matDialogRef = inject<MatDialogRef<DialogPromptComponent>>(MatDialogRef);
  private _translateService = inject(TranslateService);
  data = inject(MAT_DIALOG_DATA);

  T: typeof T = T;
  txtVal: string = this.data.txtValue || '';
  /** What the mobile keyboard is told about the field: layout, capitals, correction, Enter. */
  readonly hints: InputHintAttributes = getInputHintAttributes(this.data.type);

  // A plain message names the dialog ("Add section"); rich text (links, lists)
  // stays in the body. Without a message the field's own label is the title.
  readonly message: string = this.data.message
    ? this._translateService.instant(this.data.message)
    : '';
  readonly isMessageHtml: boolean = /[<>]/.test(this.message);
  readonly title: string =
    this.data.title ||
    (this.message && !this.isMessageHtml
      ? this.message
      : this._translateService.instant(this.data.placeholder || T.G.CONFIRM));

  close(isSave: boolean): void {
    if (isSave) {
      this._matDialogRef.close(this.txtVal);
    } else {
      this._matDialogRef.close(undefined);
    }
  }
}
