import { expect, type Page, type Locator } from '@playwright/test';
import { BasePage } from './base.page';
import * as path from 'path';

/**
 * Page object for file import operations.
 * Handles navigation to import settings and file import functionality.
 */
export class ImportPage extends BasePage {
  /** Import from file button */
  readonly importFromFileBtn: Locator;
  /** Hidden file input element */
  readonly fileInput: Locator;
  /** Import from URL button */
  readonly importFromUrlBtn: Locator;
  /** Export backup button */
  readonly exportBackupBtn: Locator;

  constructor(page: Page) {
    super(page);
    // The import button contains text "Import from file" and has the upload icon
    this.importFromFileBtn = page.locator(
      'file-imex button:has(mat-icon:text-is("upload_file"))',
    );
    this.fileInput = page.locator('file-imex input[type="file"]');
    this.importFromUrlBtn = page.locator(
      'file-imex button:has(mat-icon:has-text("cloud_download"))',
    );
    // "Export data" is the first download-icon button (privacy export is the second)
    this.exportBackupBtn = page
      .locator('file-imex button:has(mat-icon:text-is("download"))')
      .first();
  }

  /**
   * Navigate to the import/export controls.
   *
   * Settings is a dialog with a category list; the import/export buttons
   * (`file-imex`) are always visible in the "Import & export" category, there is
   * no expander to open.
   */
  async navigateToImportPage(): Promise<void> {
    await this.page.goto('/#/config', { waitUntil: 'domcontentloaded' });
    await this.page.locator('config-page').waitFor({ state: 'visible', timeout: 10000 });

    const syncBackupCategory = this.page
      .locator('config-page .settings-categories')
      .getByRole('button', { name: 'Import & export', exact: true });
    await syncBackupCategory.waitFor({ state: 'visible', timeout: 10000 });
    await syncBackupCategory.click();
    await expect(syncBackupCategory).toHaveAttribute('aria-current', 'page');

    await this.importFromFileBtn.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Import a backup file using the file input.
   * This triggers the native file dialog via Playwright's setInputFiles.
   *
   * @param filePath - Absolute path to the backup JSON file
   */
  async importBackupFile(filePath: string): Promise<void> {
    // Start listening for the import completion signal BEFORE triggering the import.
    // The "[SP_ALL] Load(import) all data" console message fires when
    // BackupService.importCompleteBackup() has persisted to IndexedDB and dispatched to NgRx.
    // We must start listening first because handleFileInput() reads the file asynchronously
    // via FileReader, and the import may complete before we start listening.
    const importCompletePromise = this.page.waitForEvent('console', {
      predicate: (msg) => msg.text().includes('Load(import) all data'),
      timeout: 60000,
    });

    // Set the file on the hidden input element.
    // setInputFiles() triggers the (change) event on the input, which starts the import.
    // Do NOT dispatch an additional change event — that would trigger the import twice.
    await this.fileInput.setInputFiles(filePath);

    // Handle encryption warning dialog if it appears.
    // The dialog may appear several seconds after setInputFiles because FileReader is async.
    // Race: either the dialog appears (handle it) or the import completes without it.
    // Catch the dialog timeout so a slow import (cold dev server, large seed) doesn't
    // reject the race before importCompletePromise has a chance to resolve.
    const encryptionWarning = this.page
      .locator('dialog-import-encryption-warning')
      .first();
    const dialogOrImport = await Promise.race([
      encryptionWarning
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => 'dialog' as const)
        .catch(() => 'no_dialog' as const),
      importCompletePromise.then(() => 'import_complete' as const),
    ]);

    if (dialogOrImport === 'dialog') {
      console.log('[ImportPage] Encryption warning dialog appeared - confirming import');
      const confirmBtn = encryptionWarning.locator('button[color="warn"]');
      await confirmBtn.click();
      await encryptionWarning.waitFor({ state: 'hidden', timeout: 10000 });
      // Now wait for the import to actually complete
      await importCompletePromise;
    } else if (dialogOrImport === 'no_dialog') {
      // Dialog didn't appear within 15s — import is slow but may still complete.
      // Wait for the import-complete signal (its own 60s timeout will catch a true hang).
      await importCompletePromise;
    }
    // If 'import_complete', the import finished without showing the dialog

    // Wait for Angular router navigation to TODAY tag (happens right after dispatch)
    const startTime = Date.now();
    const timeout = 10000;
    while (Date.now() - startTime < timeout) {
      const url = this.page.url();
      if (url.includes('tag') && url.includes('TODAY')) {
        break;
      }
      await this.page.waitForTimeout(200);
    }

    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(500);

    // Settings is a dialog: its backdrop covers the app header (sync button,
    // ...) until it is closed, and nothing after an import needs it open.
    await this.closeSettingsWindowIfOpen();
  }

  /**
   * Close the Settings window when it is still open after navigating to the
   * import controls, so the workspace underneath takes clicks again.
   */
  private async closeSettingsWindowIfOpen(): Promise<void> {
    const header = this.page.locator('.settings-window-header');
    if (!(await header.isVisible().catch(() => false))) {
      return;
    }
    await header.getByRole('button', { name: 'Close' }).click();
    await header.waitFor({ state: 'hidden', timeout: 10000 });
  }

  /**
   * Get the path to a test fixture file.
   *
   * @param filename - Name of the fixture file in e2e/fixtures/
   * @returns Absolute path to the fixture file
   */
  static getFixturePath(filename: string): string {
    return path.resolve(__dirname, '..', 'fixtures', filename);
  }
}
