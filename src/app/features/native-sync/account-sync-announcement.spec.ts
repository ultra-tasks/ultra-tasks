import { signal } from '@angular/core';
import {
  announcementFor,
  nextAnnouncement,
  type SyncAnnouncement,
} from './account-sync-announcement';
import type { AccountStatusId } from './account-sync-status.model';

describe('nextAnnouncement', () => {
  const status = (id: AccountStatusId): { id: AccountStatusId; labelKey: string } => ({
    id,
    labelKey: `LABEL.${id}`,
  });
  /** Feeds the ids in order, the way the header's linked signal does. */
  const run = (ids: AccountStatusId[]): SyncAnnouncement[] => {
    const seen: SyncAnnouncement[] = [];
    let previous: SyncAnnouncement | undefined;
    for (const id of ids) {
      previous = nextAnnouncement(previous, status(id));
      seen.push(previous);
    }
    return seen;
  };

  it('says nothing at first render, whatever the state', () => {
    for (const id of ['up-to-date', 'locked', 'offline', 'error', 'syncing'] as const) {
      expect(run([id])[0].labelKey)
        .withContext(id)
        .toBeNull();
    }
  });

  it('never announces routine syncing, nor the "up to date" that ends it', () => {
    const seen = run(['up-to-date', 'syncing', 'up-to-date', 'syncing', 'up-to-date']);
    expect(seen.map((s) => s.labelKey)).toEqual([null, null, null, null, null]);
  });

  it('announces a state that needs the user when it begins', () => {
    const seen = run(['up-to-date', 'locked']);
    expect(seen[1].labelKey).toBe('LABEL.locked');
  });

  it('announces going offline, and the recovery from it', () => {
    const seen = run(['up-to-date', 'offline', 'up-to-date']);
    expect(seen[1].labelKey).toBe('LABEL.offline');
    expect(seen[2].labelKey).toBe('LABEL.up-to-date');
  });

  it('announces recovery through a retry that passes by syncing', () => {
    const seen = run(['up-to-date', 'error', 'syncing', 'up-to-date']);
    expect(seen[1].labelKey).toBe('LABEL.error');
    // The retry itself is routine and keeps the last words...
    expect(seen[2].labelKey).toBe('LABEL.error');
    // ...and the success that ends the failure is worth saying.
    expect(seen[3].labelKey).toBe('LABEL.up-to-date');
  });

  it('announces the stages of a first download, then the result', () => {
    const seen = run(['choose-data', 'downloading', 'applying', 'up-to-date']);
    expect(seen.map((s) => s.labelKey)).toEqual([
      null,
      'LABEL.downloading',
      'LABEL.applying',
      'LABEL.up-to-date',
    ]);
  });

  it('does not repeat itself when the same state is seen again', () => {
    const first = run(['up-to-date', 'error'])[1];
    expect(nextAnnouncement(first, status('error'))).toBe(first);
  });

  it('is silent while the first sync of a session is already running', () => {
    const seen = run(['syncing', 'up-to-date']);
    expect(seen[1].labelKey).toBeNull();
  });

  describe('announcementFor', () => {
    it('follows a status signal: silent first, then each meaningful change', () => {
      const current = signal(status('up-to-date'));
      const announced = announcementFor(current);
      expect(announced().labelKey).toBeNull();

      current.set(status('locked'));
      expect(announced().labelKey).toBe('LABEL.locked');

      current.set(status('up-to-date'));
      expect(announced().labelKey).toBe('LABEL.up-to-date');
    });

    it('keeps the last words when the status object is rebuilt with the same state', () => {
      const current = signal(status('error'));
      const announced = announcementFor(current);
      announced();
      current.set(status('up-to-date'));
      const before = announced();
      current.set({ ...status('up-to-date') });
      expect(announced()).toBe(before);
    });
  });
});
