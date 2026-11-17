import type { Locator, Page } from '@playwright/test';

/**
 * The Description row of the open task panel.
 *
 * The row opens folded for a task without notes (so Links & Files, Tags and Created
 * stay in view), and its editor is only created once it is open. A spec that types
 * into the notes of a fresh task opens it first; a task that has notes opens
 * expanded, and this does nothing.
 */
export const expandTaskNotes = async (page: Page): Promise<Locator> => {
  const panel = page.locator('task-detail-panel');
  const notes = panel.locator('inline-markdown').first();
  if ((await notes.count()) === 0) {
    await panel
      .locator('mat-expansion-panel-header', { hasText: 'Description' })
      .first()
      .click();
    await notes.waitFor({ state: 'attached' });
  }
  return notes;
};
