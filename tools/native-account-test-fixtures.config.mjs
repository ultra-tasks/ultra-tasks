import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const fixture = 'tests/provider-migration.harness.ts';
const source = resolve(fixture).replaceAll('\\', '/');
const overlay = process.env.ULTRA_ACCOUNTS_HARNESS_OVERLAY;
if (!overlay) throw new Error('Use the accounts:harness server command');

export default {
  plugins: [
    {
      name: 'native-account-acceptance-fixtures',
      enforce: 'pre',
      load(id) {
        if (id === source) return readFileSync(overlay, 'utf8');
      },
    },
  ],
  test: {
    environment: 'node',
    include: [fixture],
    testTimeout: 3600000,
    hookTimeout: 60000,
  },
};
