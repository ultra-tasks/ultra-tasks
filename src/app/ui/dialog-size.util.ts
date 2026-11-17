import { inject } from '@angular/core';
import { MatDialogConfig, MatDialogRef } from '@angular/material/dialog';

/**
 * Dialog widths of the design language (docs/styling-guide.md § Dialogs):
 * - `s` 440px: confirm, prompt, estimate, schedule, deadline, reminder
 * - `m` 560px: entity forms (project, tag, habit, repeat, sync, import)
 * - `l` 720px: reference content (keyboard help, logs, conflict details)
 * - `window` 1040px: the Settings and Plugins windows
 *
 * The `.dialog-s|m|l|window` panel classes in `_overwrite-material.scss` read
 * the `--dialog-w-*` tokens and never exceed the viewport minus its gutters. A
 * dialog opened without a size is at least `s` wide.
 */
export type DialogSize = 's' | 'm' | 'l' | 'window';

/**
 * For one call site: spread into `MatDialog.open()`,
 * `open(Cmp, { ...dialogSize('window', 'settings-window'), data })`. Extra panel
 * classes ride along.
 */
export const dialogSize = (
  size: DialogSize,
  ...extraClasses: string[]
): Pick<MatDialogConfig, 'panelClass'> => ({
  panelClass: extraClasses.length
    ? [`dialog-${size}`, ...extraClasses]
    : `dialog-${size}`,
});

/**
 * For a dialog that always has the same size, wherever it is opened from: call
 * it in a field initialiser, `private readonly _size = useDialogSize('m')`. The
 * call sites then set no width of their own.
 */
export const useDialogSize = (size: DialogSize): void => {
  inject(MatDialogRef, { optional: true })?.addPanelClass?.(`dialog-${size}`);
};

/**
 * A share of the viewport height as `dvh`, which follows the visible viewport
 * (browser bars, the keyboard), or as `vh` in a WebView older than Chrome 108,
 * which does not know the unit and would drop the declaration.
 */
export const viewportHeight = (percent: number): string =>
  `${percent}${typeof CSS !== 'undefined' && CSS.supports?.('height', '1dvh') ? 'dvh' : 'vh'}`;

/**
 * The tall window the Settings, Plugins and task-notes dialogs share: 86% of the
 * viewport height and never more than 96%. Spread it into `MatDialog.open()`.
 */
export const dialogWindowHeight = (): Pick<MatDialogConfig, 'height' | 'maxHeight'> => ({
  height: viewportHeight(86),
  maxHeight: viewportHeight(96),
});
