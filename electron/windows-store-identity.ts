import { app } from 'electron';
import { readFileSync } from 'fs';
import { join, win32 } from 'path';

interface WindowsStoreIdentity {
  packageFamilyName: string;
  applicationId: string;
}

/** Metadata exists only in the dedicated Store build, never in EXE downloads. */
export const getWindowsStoreIdentity = (): WindowsStoreIdentity | undefined => {
  if (!process.windowsStore) return undefined;
  const metadata = JSON.parse(
    readFileSync(join(app.getAppPath(), 'package.json'), 'utf8'),
  ) as { ultraTasksWindowsStore?: WindowsStoreIdentity };
  return metadata.ultraTasksWindowsStore;
};

/** A custom --user-data-dir outside Roaming is not subject to this redirection. */
export const getWindowsStoreUserDataDir = (
  userDataDir: string,
  roamingDir: string,
  packageFamilyName: string,
): string | undefined => {
  const relative = win32.relative(roamingDir, userDataDir);
  if (win32.isAbsolute(relative) || relative === '..' || relative.startsWith('..\\')) {
    return undefined;
  }
  return win32.join(
    roamingDir,
    '..',
    'Local',
    'Packages',
    packageFamilyName,
    'LocalCache',
    'Roaming',
    relative,
  );
};
