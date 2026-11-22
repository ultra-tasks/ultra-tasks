import { FormsModule } from '@angular/forms';
import { MatFormField, MatLabel } from '@angular/material/form-field';
import { MatSelect } from '@angular/material/select';
import { MatOption } from '@angular/material/core';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { SettingHelpComponent } from '../../ui/setting-help/setting-help.component';
import { BackupPassphraseDialogComponent } from './backup-passphrase-dialog.component';
import {
  encryptBackupFile,
  decryptBackupFile,
  ENCRYPTED_BACKUP_FORMAT,
} from './encrypted-backup.util';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  inject,
  Injector,
  viewChild,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { MatDialog } from '@angular/material/dialog';
import { SnackService } from '../../core/snack/snack.service';
import { download } from '../../util/download';
import {
  BACKUP_FILENAME_PREFIX,
  BACKUP_FILENAME_PREFIX_ANONYMIZED,
  getBackupTimestamp,
} from '../../../../electron/shared-with-frontend/get-backup-timestamp';
import { DialogImportFromUrlComponent } from '../dialog-import-from-url/dialog-import-from-url.component';
import { T } from '../../t.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { ActivatedRoute, Router } from '@angular/router';
import { privacyExport } from './privacy-export';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { AppDataComplete } from '../../op-log/model/model-config';
import { BackupService } from '../../op-log/backup/backup.service';
import { LocalDraftService } from '../../core/draft/local-draft.service';
import { IS_NATIVE_PLATFORM } from '../../util/is-native-platform';
import { ImportEncryptionHandlerService } from '../sync/import-encryption-handler.service';
import { first } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import {
  DialogImportEncryptionWarningComponent,
  ImportEncryptionWarningData,
  ImportEncryptionWarningResult,
} from '../sync/dialog-import-encryption-warning/dialog-import-encryption-warning.component';
import {
  ConfirmUrlImportDialogComponent,
  DialogConfirmUrlImportData,
} from '../dialog-confirm-url-import/dialog-confirm-url-import.component';
import { Log } from '../../core/log';
import { DialogArchiveCompressionComponent } from '../../features/archive/dialog-archive-compression/dialog-archive-compression.component';
import {
  BackupRepairFailedError,
  DataValidationFailedError,
} from '../../op-log/core/errors/sync-errors';
import { alertDialog } from '../../util/native-dialogs';
import {
  BuiltinImportService,
  BuiltinImportPreview,
} from '../importers/builtin-import.service';
import { ImportResult } from '../../../../packages/plugin-dev/todoist-import/src/map/run-import';

import { PluginService } from '../../plugins/plugin.service';
import {
  MS_TODO_IMPORT_PLUGIN_ID,
  MS_TODO_OAUTH_CONFIG,
} from '../../plugins/oauth/ms-todo-import-oauth';

@Component({
  selector: 'file-imex',
  templateUrl: './file-imex.component.html',
  styleUrls: ['./file-imex.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIcon,
    MatButton,
    MatTooltip,
    TranslatePipe,
    FormsModule,
    MatFormField,
    MatLabel,
    MatSelect,
    MatOption,
    MatSlideToggle,
    SettingHelpComponent,
  ],
})
export class FileImexComponent implements OnInit {
  private _snackService = inject(SnackService);
  private _router = inject(Router);
  private _backupService = inject(BackupService);
  private _localDraftService = inject(LocalDraftService);
  private _activatedRoute = inject(ActivatedRoute);
  private _matDialog = inject(MatDialog);
  private _http = inject(HttpClient);
  private _importEncryptionHandler = inject(ImportEncryptionHandlerService);
  private _builtinImport = inject(BuiltinImportService);
  private _cd = inject(ChangeDetectorRef);
  private _injector = inject(Injector);
  readonly isMsTodoImportAvailable = !!MS_TODO_OAUTH_CONFIG;

  readonly fileInputRef = viewChild<ElementRef>('fileInput');
  T: typeof T = T;
  importSource = 'ultra';
  encryptExport = false;
  importPreview: BuiltinImportPreview | null = null;
  importResult: ImportResult | null = null;
  importError = '';
  isImporting = false;
  readonly importGuides = {
    ultra: {
      title: T.PS.REFINEMENT.NATIVE,
      steps: [T.PS.IMPORTER.ULTRA_STEP_1, T.PS.IMPORTER.NATIVE_STEP_2],
      help: T.PS.IMPORTER.NATIVE_WARNING,
    },
    ['super-productivity']: {
      title: T.PS.REFINEMENT.UPSTREAM,
      steps: [T.PS.IMPORTER.SP_STEP_1, T.PS.IMPORTER.NATIVE_STEP_2],
      help: T.PS.IMPORTER.NATIVE_WARNING,
    },
    todoist: {
      title: T.PS.REFINEMENT.TODOIST,
      steps: [T.PS.IMPORTER.TODOIST_STEP_1, T.PS.IMPORTER.CSV_STEP_2],
      help: T.PS.IMPORTER.TODOIST_LIMITS,
      url: 'https://www.todoist.com/help/account-and-billing/security/import-or-export-a-project-as-a-csv-file-in-todoist-YC8YvN',
    },
    ticktick: {
      title: T.PS.REFINEMENT.TICKTICK,
      steps: [T.PS.IMPORTER.TICKTICK_STEP_1, T.PS.IMPORTER.CSV_STEP_2],
      help: T.PS.IMPORTER.TICKTICK_LIMITS,
      url: 'https://help.ticktick.com/articles/7055781405648748544',
    },
    url: {
      title: T.FILE_IMEX.OPEN_IMPORT_FROM_URL_DIALOG,
      steps: [T.PS.IMPORTER.URL_STEP_1, T.PS.IMPORTER.URL_STEP_2],
      help: T.PS.IMPORTER.NATIVE_WARNING,
    },
  };
  get selectedGuide(): { title: string; steps: string[]; help: string; url?: string } {
    return this.importGuides[this.importSource as keyof typeof this.importGuides];
  }
  get isCsvImport(): boolean {
    return this.importSource === 'todoist' || this.importSource === 'ticktick';
  }
  resetImport(): void {
    this.importPreview = this.importResult = null;
    this.importError = '';
    const input = this.fileInputRef()?.nativeElement;
    if (input) input.value = '';
  }
  async importSelected(): Promise<void> {
    if (this.importSource === 'url') this.openUrlImportDialog();
    else this.fileInputRef()?.nativeElement.click();
  }

  async openMsTodoImport(): Promise<void> {
    if (!this.isMsTodoImportAvailable) return;
    try {
      const plugins = this._injector.get(PluginService);
      if (!plugins.isInitialized()) await plugins.initializePlugins();
      const instance = await plugins.activatePlugin(MS_TODO_IMPORT_PLUGIN_ID, true);
      if (!instance) throw new Error('Microsoft To Do import is unavailable.');
      if (await this._router.navigate(['/plugins', MS_TODO_IMPORT_PLUGIN_ID, 'index'])) {
        // Settings is a persistent dialog, so routing does not remove its overlay.
        this._matDialog.getDialogById('settings-window')?.close();
      }
    } catch {
      this._snackService.open({
        type: 'ERROR',
        msg: T.FILE_IMEX.S_ERR_MS_TODO_IMPORT_OPEN,
      });
    }
  }

  async importTasks(): Promise<void> {
    if (!this.importPreview || this.isImporting || this.importResult) return;
    this.isImporting = true;
    try {
      this.importResult = await this._builtinImport.run(this.importPreview);
    } catch {
      // A run can have created projects already: do not offer a blind retry.
      this.importError = T.PS.IMPORTER.PARTIAL_ERROR;
      this.importPreview = null;
    } finally {
      this.isImporting = false;
      this._cd.markForCheck();
    }
  }

  ngOnInit(): void {
    this._activatedRoute.queryParams.pipe(first()).subscribe((params) => {
      const importUrlParam = params['importFromUrl'];
      if (importUrlParam) {
        // Clear the parameter from the URL immediately
        this._router.navigate([], {
          relativeTo: this._activatedRoute,
          queryParams: { importFromUrl: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });

        let decodedUrl: string;
        try {
          decodedUrl = decodeURIComponent(importUrlParam);
        } catch (e) {
          Log.err('Error decoding importFromUrl parameter:', e);
          this._snackService.open({
            type: 'ERROR',
            msg: T.FILE_IMEX.S_IMPORT_FROM_URL_ERR_DECODE,
          });
          return;
        }

        this._matDialog
          .open<ConfirmUrlImportDialogComponent, DialogConfirmUrlImportData, boolean>(
            ConfirmUrlImportDialogComponent,
            {
              data: { domain: new URL(decodedUrl).hostname },
            },
          )
          .afterClosed()
          .subscribe(async (confirmed) => {
            if (confirmed) {
              await this.importFromUrlHandler(decodedUrl);
            }
          });
      }
    });
  }

  // NOTE: after promise done the file is NOT yet read
  async handleFileInput(ev: Event): Promise<void> {
    const files = (ev.target as HTMLInputElement).files;
    const file = files?.item(0);

    if (!file) {
      // No file selected or selection cancelled
      return;
    }

    if (this.importSource === 'todoist' || this.importSource === 'ticktick') {
      this.resetImport();
      this.isImporting = true;
      const source = this.importSource;
      try {
        this.importPreview = this._builtinImport.preview(
          source,
          await file.text(),
          file.name,
        );
      } catch {
        this.importError = T.PS.IMPORTER.INVALID_FILE;
      } finally {
        this.isImporting = false;
        this._cd.markForCheck();
      }
      return;
    }

    const reader = new FileReader();
    reader.onload = async () => {
      const textData = reader.result as string;
      await this._processAndImportData(textData);

      const fileInputRef = this.fileInputRef();
      if (!fileInputRef) {
        throw new Error('No file input Ref element');
      }

      // clear input
      fileInputRef.nativeElement.value = '';
      fileInputRef.nativeElement.type = 'text';
      fileInputRef.nativeElement.type = 'file';
    };
    reader.readAsText(file);
  }

  async importFromUrlHandler(url: string): Promise<void> {
    if (!url) {
      this._snackService.open({ type: 'ERROR', msg: T.FILE_IMEX.S_ERR_INVALID_URL });
      return;
    }

    try {
      const textData = await this._http
        .get(url, {
          headers: {
            Accept: 'application/json',
          },
          responseType: 'text',
        })
        .toPromise();

      await this._processAndImportData(textData);
    } catch (error) {
      // Handle network errors and HTTP errors
      Log.err('Network error or HTTP error fetching from URL:', error);
      this._snackService.open({ type: 'ERROR', msg: T.FILE_IMEX.S_ERR_NETWORK });
    }
  }

  openUrlImportDialog(): void {
    this._matDialog
      .open(DialogImportFromUrlComponent)
      .afterClosed()
      .subscribe(async (url: string | undefined) => {
        if (url) {
          await this.importFromUrlHandler(url);
        }
      });
  }

  private async _processAndImportData(dataString: string): Promise<void> {
    let data: AppDataComplete | undefined;
    let oldData: unknown; // For V1 legacy data format check

    try {
      data = oldData = JSON.parse(dataString);
    } catch (e) {
      this._snackService.open({ type: 'ERROR', msg: T.FILE_IMEX.S_ERR_INVALID_DATA });
      return; // Exit if JSON parsing fails
    }

    if (!data || !oldData) {
      this._snackService.open({ type: 'ERROR', msg: T.FILE_IMEX.S_ERR_INVALID_DATA });
      return; // Exit if data is falsy
    }

    if (
      typeof oldData === 'object' &&
      oldData !== null &&
      'format' in oldData &&
      oldData.format === ENCRYPTED_BACKUP_FORMAT
    ) {
      const passphrase = await firstValueFrom(
        this._matDialog
          .open<
            BackupPassphraseDialogComponent,
            boolean,
            string
          >(BackupPassphraseDialogComponent, { data: false })
          .afterClosed(),
      );
      if (!passphrase) return;
      try {
        const plain = await decryptBackupFile(oldData, passphrase);
        await this._processAndImportData(plain);
      } catch {
        this._snackService.open({ type: 'ERROR', msg: T.PS.REFINEMENT.DECRYPT_ERROR });
      }
      return;
    }
    // V1 data check (as in original handleFileInput)
    // TODO: consider if this check is still relevant or can be removed/updated
    const v1Data = oldData as { config?: unknown; tasks?: unknown };
    if (v1Data.config && Array.isArray(v1Data.tasks)) {
      alertDialog('V1 Data. Migration not supported any more.');
      // Potentially also use snackService here or log an error.
      // For now, keeping alert as per original logic.
      return;
    }

    try {
      // Check if encryption state will change BEFORE importing
      const encryptionCheck =
        await this._importEncryptionHandler.checkEncryptionStateChange(
          data as AppDataComplete,
        );

      // If encryption state will change, warn the user first
      if (encryptionCheck.willChange) {
        const dialogRef = this._matDialog.open<
          DialogImportEncryptionWarningComponent,
          ImportEncryptionWarningData,
          ImportEncryptionWarningResult
        >(DialogImportEncryptionWarningComponent, {
          disableClose: true,
          data: {
            currentEncryptionEnabled: encryptionCheck.currentEnabled,
            importedEncryptionEnabled: encryptionCheck.importedEnabled,
          },
        });

        const result = await firstValueFrom(dialogRef.afterClosed());
        if (!result?.confirmed) {
          // User cancelled - don't import
          Log.normal('Import cancelled by user due to encryption state change warning');
          return;
        }
      }

      // Import first, then navigate (no page reload, state updates inline)
      // isForceConflict=true only gates page reload; fresh clock is always generated
      await this._backupService.importCompleteBackup(
        data as AppDataComplete,
        false,
        true,
        true,
      );

      // The notes were just replaced wholesale, so every draft's
      // baseContent refers to content that no longer exists.
      this._localDraftService.deleteAllDrafts();

      // Handle encryption state change if needed (e.g., import has different encryption settings)
      // This ensures server data is wiped and fresh snapshot is uploaded with correct encryption
      const encryptionResult =
        await this._importEncryptionHandler.handleImportEncryptionIfNeeded(
          data as AppDataComplete,
        );
      if (encryptionResult?.error) {
        Log.warn('Import encryption handling had an issue:', encryptionResult.error);
        // Don't fail the import, just warn - the next sync will handle it
      }

      await this._router.navigate([`tag/${TODAY_TAG.id}/tasks`]);
    } catch (e) {
      Log.err('Import process failed', e);

      if (e instanceof BackupRepairFailedError) {
        this._snackService.open({
          type: 'ERROR',
          msg: T.FILE_IMEX.S_ERR_IMPORT_UNREPAIRABLE,
        });
      } else if (e instanceof DataValidationFailedError) {
        this._snackService.open({
          type: 'ERROR',
          msg: `Import failed: ${e.message}`,
          isSkipTranslate: true,
        });
      } else {
        this._snackService.open({
          type: 'ERROR',
          msg: T.FILE_IMEX.S_ERR_IMPORT_FAILED,
        });
      }
    }
  }

  async downloadBackup(): Promise<void> {
    const passphrase = this.encryptExport
      ? await firstValueFrom(
          this._matDialog
            .open<
              BackupPassphraseDialogComponent,
              boolean,
              string
            >(BackupPassphraseDialogComponent, { data: true })
            .afterClosed(),
        )
      : undefined;
    if (this.encryptExport && !passphrase) return;
    const data = await this._backupService.loadCompleteBackup(true);
    const json = JSON.stringify(data);
    const contents = passphrase ? await encryptBackupFile(json, passphrase) : json;
    const fileName = `${BACKUP_FILENAME_PREFIX}_${getBackupTimestamp()}.json`;
    const result = await download(fileName, contents);
    if ((IS_NATIVE_PLATFORM && !result.wasCanceled) || result.isSnap) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: result.path
          ? `Backup saved to: ${result.path}`
          : T.FILE_IMEX.S_BACKUP_DOWNLOADED,
      });
    }
  }

  async privacyAppDataDownload(): Promise<void> {
    const data = await this._backupService.loadCompleteBackup(true);
    const fileName = `${BACKUP_FILENAME_PREFIX_ANONYMIZED}_${getBackupTimestamp()}.json`;
    const result = await download(fileName, privacyExport(data));
    if ((IS_NATIVE_PLATFORM && !result.wasCanceled) || result.isSnap) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: result.path
          ? `Backup saved to: ${result.path}`
          : T.FILE_IMEX.S_BACKUP_DOWNLOADED,
      });
    }
  }

  openArchiveCompression(): void {
    this._matDialog.open(DialogArchiveCompressionComponent);
  }
}
