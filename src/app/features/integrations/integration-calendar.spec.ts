import { DEFAULT_TASK } from '../tasks/task.model';
import { createIntegrationCalendar } from './integration-calendar';
describe('Integration calendar export', () => {
  it('exports scheduled tasks with stable IDs and UTC durations, excluding private notes', () => {
    const ics = createIntegrationCalendar([
      {
        ...DEFAULT_TASK,
        projectId: 'project',
        id: 'one',
        title: 'Plan, build; ship',
        notes: 'private',
        dueWithTime: Date.parse('2026-11-08T14:00:00Z'),
        timeEstimate: 1800000,
      },
    ]);
    expect(ics).toContain('UID:one@ultratasks');
    expect(ics).toContain('DTSTART:20261108T140000Z');
    expect(ics).toContain('DTEND:20261108T143000Z');
    expect(ics).toContain('SUMMARY:Plan\\, build\\; ship');
    expect(ics).not.toContain('private');
  });
  it('preserves date-only scheduling and skips unscheduled tasks', () => {
    const ics = createIntegrationCalendar([
      {
        ...DEFAULT_TASK,
        projectId: 'project',
        id: 'date',
        title: 'Day task',
        dueDay: '2026-03-29',
      },
      { ...DEFAULT_TASK, projectId: 'project', id: 'unplanned', title: 'Unplanned' },
    ]);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260329');
    expect(ics).not.toContain('unplanned');
  });
  it('folds non-ASCII text at the RFC byte boundary', () => {
    const ics = createIntegrationCalendar([
      {
        ...DEFAULT_TASK,
        projectId: 'project',
        id: 'one',
        title: '日'.repeat(90),
        dueDay: '2026-11-08',
      },
    ]);
    expect(
      ics.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75),
    ).toBeTrue();
    expect(ics.replace(/\r\n /g, '')).toContain('日'.repeat(90));
  });
});
