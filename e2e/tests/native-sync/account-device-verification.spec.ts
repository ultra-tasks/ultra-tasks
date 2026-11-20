import { expect, test } from '@playwright/test';
import {
  addLocalTask,
  closeDevices,
  engineView,
  newDevice,
  signIn,
  taskTitles,
} from './native-account-helpers';

test('@ultra verifies a new browser from the in-app sign-in form', async ({
  browser,
}) => {
  test.skip(
    process.env.E2E_ULTRA_VERIFY_DEVICE !== '1',
    'Requires the synthetic new-device email verification fixture',
  );
  test.setTimeout(150_000);
  const device = await newDevice(browser, 'Unverified device');
  const title = 'Work saved before verifying this device';
  try {
    await addLocalTask(device, title);
    await signIn(device.page, 'personaldeviceverify');
    let code = '';
    await expect
      .poll(
        async () => {
          const response = await device.page.request.get('/provider-device-verification');
          if (response.ok()) ({ code } = (await response.json()) as { code: string });
          return /^\d{8}$/.test(code);
        },
        { timeout: 25_000 },
      )
      .toBe(true);

    const card = device.page.locator('native-sync');
    await expect(card.getByRole('heading', { name: 'Verify this device' })).toBeVisible();
    expect(await engineView(device.page)).toMatchObject({
      phase: 'verify-device',
      unlocked: false,
    });
    const field = card.getByRole('textbox', { name: 'Verification code' });
    const verify = card.getByRole('button', { name: 'Verify', exact: true });
    const wrongCode = (code[0] === '0' ? '1' : '0') + code.slice(1);
    await field.fill(wrongCode);
    await verify.click();
    await expect(card.getByRole('alert')).toBeVisible();
    await expect(field).toBeVisible();

    await field.fill(code);
    await verify.click();
    await expect
      .poll(() => engineView(device.page), { timeout: 60_000 })
      .toMatchObject({ unlocked: true, linked: true, error: '' });
    expect(await taskTitles(device.page)).toContain(title);
  } finally {
    await closeDevices(device);
  }
});
