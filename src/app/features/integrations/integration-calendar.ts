import type { Task } from '../tasks/task.model';
const escapeIcs = (value: string): string =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
const utc = (time: number): string =>
  new Date(time)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
// RFC 5545 folds content lines at 75 UTF-8 octets, including the continuation space.
const fold = (line: string): string => {
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 75) {
      parts.push(current);
      current = ' ';
      bytes = 1;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n');
};
export interface CalendarPublicationOptions {
  privacy: 'busy' | 'titles';
  revision: number;
  updatedAt: number;
  windowStart: number;
  windowEnd: number;
}

export const createIntegrationCalendar = (
  tasks: Task[],
  publication?: CalendarPublicationOptions,
): string => {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//UltraTasks//Task Export//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const task of tasks) {
    if (!task.dueWithTime && !task.dueDay) continue;
    if (publication) {
      const date = task.dueWithTime ?? Date.parse(`${task.dueDay}T12:00:00Z`);
      if (date < publication.windowStart || date > publication.windowEnd || task.isDone)
        continue;
    }
    lines.push(
      'BEGIN:VEVENT',
      `UID:${escapeIcs(task.id)}@ultratasks`,
      `DTSTAMP:${publication ? utc(publication.updatedAt) : '19700101T000000Z'}`,
      `SUMMARY:${publication?.privacy === 'busy' ? 'Busy' : escapeIcs(task.title)}`,
      ...(publication ? [`SEQUENCE:${publication.revision}`, 'CLASS:PUBLIC'] : []),
    );
    if (task.dueWithTime)
      lines.push(
        `DTSTART:${utc(task.dueWithTime)}`,
        `DTEND:${utc(task.dueWithTime + (task.timeEstimate || 3600000))}`,
      );
    else lines.push(`DTSTART;VALUE=DATE:${task.dueDay!.replace(/-/g, '')}`);
    // Private notes deliberately remain local. Completion is not a standard VEVENT field.
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
};
