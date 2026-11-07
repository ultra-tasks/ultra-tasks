const MS_PER_MINUTE = 60_000;

/**
 * The `YYYY-MM-DD` of an instant in the timezone the tests run in, derived from
 * that zone's UTC offset at that instant.
 *
 * The timezone specs used to hard-code "LA gives the 16th, Berlin the 17th" and
 * pick a branch by the sign of the offset. That only holds in exactly those two
 * zones, and the `TZ` variable is not honoured by Chrome on Windows, where
 * Karma runs in the operating system's zone. Computing the expectation from the
 * offset is right in any zone, and does not use the local `Date` getters or
 * `getDbDateStr`, so it stays independent of the code under test.
 */
export const localDateStrAt = (ms: number): string => {
  const offsetMs = new Date(ms).getTimezoneOffset() * MS_PER_MINUTE;
  return new Date(ms - offsetMs).toISOString().slice(0, 10);
};
