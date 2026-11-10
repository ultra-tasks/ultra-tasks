import { app } from 'electron';
import { PROTOCOL_PREFIX } from './protocol-handler';
import { startApp } from './start-app';
import { applyLegacyForkUserDataDir, applySnapUserDataDir } from './user-data-dir';
import { getWindowsStoreIdentity } from './windows-store-identity';

const IS_MAC = process.platform === 'darwin';

if (process.platform === 'win32') {
  const storeIdentity = getWindowsStoreIdentity();
  app.setAppUserModelId(
    storeIdentity
      ? `${storeIdentity.packageFamilyName}!${storeIdentity.applicationId}`
      : 'app.ultratasks',
  );
}

// Before the single-instance lock, which lives in the userData dir (#11049).
applyLegacyForkUserDataDir(app);
applySnapUserDataDir(app);

if (!IS_MAC) {
  // make it a single instance by closing other instances but allow for dev mode
  // because of https://github.com/electron/electron/issues/14094
  const isLockObtained = app.requestSingleInstanceLock();
  if (!isLockObtained) {
    const hasProtocolUrl = process.argv.some((arg) => arg.startsWith(PROTOCOL_PREFIX));
    if (!hasProtocolUrl) {
      console.log('Another instance is already running. Exiting.');
    }
    // Force immediate exit without waiting for graceful shutdown
    process.exit(0);
  } else {
    console.log('Start app...');
    startApp();
  }
} else {
  startApp();
}
