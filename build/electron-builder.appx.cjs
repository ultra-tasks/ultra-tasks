'use strict';

const { getWindowsStoreConfig } = require('../tools/windows-store-config');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { load } = require('js-yaml');

// Explicitly replace win.target: electron-builder inheritance concatenates arrays.
module.exports = getWindowsStoreConfig(
  process.env,
  require('../package.json').version,
  load(readFileSync(join(__dirname, '..', 'electron-builder.yaml'), 'utf8')),
);
