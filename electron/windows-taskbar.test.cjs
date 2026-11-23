const assert = require('node:assert/strict');
const test = require('node:test');
require('ts-node/register/transpile-only');
const { configureWindowsTaskbar } = require('./windows-taskbar.ts');

const execPath = 'C:\\Program Files\\Ultra Tasks\\Ultra Tasks.exe';
const desktopRuntime = { platform: 'win32', execPath, env: {} };

test('the installed app sets an explicit taskbar icon and quotes the relaunch path', () => {
  const setAppDetails = test.mock.fn();
  configureWindowsTaskbar({ setAppDetails }, true, desktopRuntime);

  assert.deepEqual(
    setAppDetails.mock.calls.map((call) => call.arguments),
    [
      [
        {
          appId: 'app.ultratasks',
          appIconPath: execPath,
          relaunchCommand: `"${execPath}"`,
          relaunchDisplayName: 'Ultra Tasks',
        },
      ],
    ],
  );
});

test('the portable app uses the persistent launcher for both the icon and relaunch', () => {
  const launcher = 'D:\\Portable Apps\\Ultra Tasks.exe';
  const setAppDetails = test.mock.fn();
  configureWindowsTaskbar({ setAppDetails }, true, {
    ...desktopRuntime,
    execPath: 'C:\\Users\\test\\AppData\\Local\\Temp\\nsis\\Ultra Tasks.exe',
    env: { PORTABLE_EXECUTABLE_FILE: launcher },
  });

  assert.equal(setAppDetails.mock.callCount(), 1);
  const [details] = setAppDetails.mock.calls[0].arguments;
  assert.equal(details.appIconPath, launcher);
  assert.equal(details.relaunchCommand, `"${launcher}"`);
});

test('Store packages, development runs and other platforms keep their existing icon behavior', () => {
  const setAppDetails = test.mock.fn();
  const win = { setAppDetails };
  configureWindowsTaskbar(win, true, { ...desktopRuntime, windowsStore: true });
  configureWindowsTaskbar(win, false, desktopRuntime);
  configureWindowsTaskbar(win, true, { ...desktopRuntime, platform: 'linux' });
  configureWindowsTaskbar(win, true, { ...desktopRuntime, platform: 'darwin' });

  assert.equal(setAppDetails.mock.callCount(), 0);
});
