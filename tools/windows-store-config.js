'use strict';

const getWindowsStoreConfig = (env, version, base = {}) => {
  const keys = [
    'WINDOWS_STORE_IDENTITY_NAME',
    'WINDOWS_STORE_PUBLISHER',
    'WINDOWS_STORE_PUBLISHER_DISPLAY_NAME',
    'WINDOWS_STORE_PACKAGE_FAMILY_NAME',
  ];
  const missing = keys.filter((key) => !env[key]?.trim());
  if (missing.length) {
    throw new Error(
      `Missing Partner Center identity values: ${missing.join(', ')}. See docs/microsoft-store-publishing.md.`,
    );
  }
  const [identityName, publisher, publisherDisplayName, packageFamilyName] = keys.map(
    (key) => env[key].trim(),
  );
  if (!/^[A-Za-z0-9.-]{3,50}$/.test(identityName) || !publisher.startsWith('CN=')) {
    throw new Error(
      'Copy the exact package identity name and publisher from Partner Center.',
    );
  }
  if (
    !new RegExp(`^${identityName.replace(/\./g, '\\.')}_[0-9a-hjkmnp-tv-z]{13}$`).test(
      packageFamilyName,
    )
  ) {
    throw new Error(
      'Package Family Name must match the Partner Center package identity.',
    );
  }
  if (
    !/^\d+\.\d+\.\d+$/.test(version) ||
    version.split('.').some((part) => Number(part) > 65535)
  ) {
    throw new Error(
      'Store packages require a numeric major.minor.patch version (each at most 65535).',
    );
  }
  return {
    ...base,
    directories: { ...base.directories, output: '.tmp/store-builds' },
    artifactName: 'Ultra-Tasks-Store-${version}-${arch}.${ext}',
    publish: null,
    win: {
      ...base.win,
      target: [{ target: 'appx', arch: ['x64', 'arm64'] }],
      publish: null,
      // Store submissions are unsigned even on machines with signing credentials.
      signExecutable: false,
    },
    protocols: [{ name: 'Ultra Tasks', schemes: ['ultratasks'] }],
    appx: {
      applicationId: 'UltraTasks',
      displayName: 'Ultra Tasks',
      identityName,
      publisher,
      publisherDisplayName,
      setBuildNumber: false,
      minVersion: '10.0.19041.0',
      addAutoLaunchExtension: false,
      capabilities: ['runFullTrust'],
    },
    extraMetadata: {
      ultraTasksWindowsStore: { packageFamilyName, applicationId: 'UltraTasks' },
    },
  };
};

module.exports = { getWindowsStoreConfig };
