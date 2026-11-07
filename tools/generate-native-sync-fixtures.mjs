#!/usr/bin/env node
// Fresh JS SDK envelopes for the Kotlin platform verifier, without a running server.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
  createAccountBundle,
  encryptRecord,
  grantKey,
  randomKey,
  sign,
} from '@sp/sync-providers/ultra-tasks';

const serverId = crypto.randomUUID();
const accountId = crypto.randomUUID();
const account = await createAccountBundle('native vector password 🗝️', {
  serverId,
  accountId,
});
const root = account.secrets;
const keys = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const privateKey = await crypto.subtle.exportKey('jwk', keys.privateKey);
const deviceId = crypto.randomUUID();
const certificate = {
  serverId,
  accountId,
  deviceId,
  publicKey: await crypto.subtle.exportKey('jwk', keys.publicKey),
};
const signedCertificate = {
  ...certificate,
  signature: await sign(root.signingPrivateKey, certificate),
};
const projectId = crypto.randomUUID();
const personalId = crypto.randomUUID();
const remindAt = 4102444800000;
const title = 'Müsli 🥣 </script> 買い物\u2028';
const fixture = async (scopeId, kind, records) => {
  const key = randomKey();
  const mutationId = crypto.randomUUID();
  const authorization = {
    serverId,
    scopeId,
    ownerId: accountId,
    accountId,
    role: 'owner',
    epoch: 1,
    inviteId: crypto.randomUUID(),
    encryptionPublicKey: account.bundle.encryptionPublicKey,
    signingPublicKey: account.bundle.signingPublicKey,
    grant: await grantKey(account.bundle.encryptionPublicKey, key, {
      serverId,
      scopeId,
      recipientId: accountId,
      epoch: 1,
    }),
  };
  const membership = {
    authorization,
    signature: await sign(root.signingPrivateKey, authorization),
  };
  const writes = [];
  for (const [entityId, entityType, value] of records) {
    const header = {
      v: 2,
      serverId,
      scopeId,
      entityId,
      entityType,
      actorId: accountId,
      deviceId,
      mutationId,
      epoch: 1,
      generation: 1,
      controlVersion: 1,
      counter: 1,
      baseRevision: 0,
      revision: 1,
    };
    writes.push({
      record: await encryptRecord(header, { value, deleted: false }, key, privateKey),
      deleted: false,
    });
  }
  const mutation = {
    v: 2,
    serverId,
    scopeId,
    epoch: 1,
    generation: 1,
    controlVersion: 1,
    deviceId,
    counter: 1,
    mutationId,
    certificate: signedCertificate,
    membership,
    writes,
  };
  const scope = {
    id: scopeId,
    kind,
    ownerId: accountId,
    ownerKey: account.bundle.signingPublicKey,
    epoch: 1,
    generation: 1,
    controlVersion: 1,
    sequence: 1,
    state: 'active',
    members: [membership],
  };
  return {
    trusted: { serverId, accountId, ...scope, key },
    snapshot: {
      scope,
      heads: writes,
      manifests: [{ ...mutation, signature: await sign(privateKey, mutation) }],
    },
  };
};
const fixtures = [
  await fixture(projectId, 'project', [
    ['shared-task', 'shared.task', { title, isDone: false }],
  ]),
  await fixture(personalId, 'personal', [
    [
      'header-🥣</\u2028\ud800',
      'personal.document',
      {
        path: ['task', 'entities', 'my-task'],
        data: {
          id: 'my-task',
          title,
          remindAt,
          deadlineRemindAt: remindAt + 10000,
          isDone: false,
        },
      },
    ],
    [
      'overlay',
      'personal.overlay',
      {
        scopeId: projectId,
        taskId: 'shared-task',
        label: title,
        remindAt,
        personalNotes: 'not copied into native reminder projection',
      },
    ],
  ]),
];
const output = resolve(process.argv[2] ?? 'android/app/build/native-sync-fixtures.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, JSON.stringify({ title, remindAt, fixtures }, null, 2) + '\n');
process.stdout.write('Generated native encrypted-record interoperability fixtures.\n');
