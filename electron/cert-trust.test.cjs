const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

require('ts-node/register/transpile-only');

const ipcHandlers = new Map();
const appHandlers = new Map();
const messages = [];
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return { ipcMain: { on: (channel, handler) => ipcHandlers.set(channel, handler) } };
  }
  if (request === 'electron-log/main') {
    return { warn: (message) => messages.push(message) };
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { initCertTrust } = require(path.resolve(__dirname, 'cert-trust.ts'));
Module._load = originalLoad;
initCertTrust({ on: (event, handler) => appHandlers.set(event, handler) });
const mainFrame = {};
const sender = { mainFrame };
const update = (hosts, senderFrame = mainFrame) =>
  ipcHandlers.get('SET_CERT_TRUSTED_HOSTS')({ sender, senderFrame }, hosts);
const check = (url) => {
  let accepted;
  let prevented = false;
  appHandlers.get('certificate-error')(
    {
      preventDefault: () => {
        prevented = true;
      },
    },
    sender,
    url,
    'net::ERR_CERT_AUTHORITY_INVALID',
    {},
    (value) => {
      accepted = value;
    },
  );
  return { accepted, prevented };
};

test('certificate errors fail closed until configured, and only matching hosts bypass validation', () => {
  update([]);
  assert.deepEqual(check('https://nas.lan/dav'), { accepted: false, prevented: false });
  update(['nas.lan']);
  assert.deepEqual(check('https://nas.lan/dav'), { accepted: true, prevented: true });
  assert.deepEqual(check('https://nas.lan:8443/dav'), {
    accepted: false,
    prevented: false,
  });
  assert.deepEqual(check('https://www.dropbox.com/'), {
    accepted: false,
    prevented: false,
  });
});

test('subframe updates cannot expand certificate trust', () => {
  update(['nas.lan']);
  update(['attacker.example'], {});
  assert.equal(check('https://attacker.example/').accepted, false);
  assert.equal(check('https://nas.lan/').accepted, true);
});

test('replacing or clearing settings revokes the host for subsequent certificate-error events', () => {
  update(['nas.lan']);
  update(['other.lan']);
  assert.equal(check('https://nas.lan/').accepted, false);
  update(null);
  assert.equal(check('https://other.lan/').accepted, false);
});

test('logs do not expose credentials, paths or query secrets', () => {
  messages.length = 0;
  update(['nas.lan']);
  check('https://user:secret@nas.lan/private?token=private');
  assert.equal(messages.length, 1);
  assert.match(messages[0], /nas\.lan/);
  assert.doesNotMatch(messages[0], /secret|private|user/);
});
