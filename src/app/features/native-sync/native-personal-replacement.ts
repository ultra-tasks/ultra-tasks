import {
  encryptRecord,
  fingerprint,
  sign,
  type Mutation,
  type RecordChange,
  type SyncClient,
} from '@sp/sync-providers/ultra-tasks';

/** Replace an existing personal inventory without exposing a partly uploaded snapshot. */
export const replacePersonalRecords = async (
  client: SyncClient,
  scopeId: string,
  records: RecordChange[],
): Promise<void> => {
  if (client.account.capabilities?.features['personalReplacement'] !== true)
    throw new Error('NATIVE_SYNC.ERROR_REPLACEMENT_UNAVAILABLE');
  const current = client.state.scopes[scopeId];
  if (current.intents.length || current.uncertain)
    throw new Error('NATIVE_SYNC.ERROR_PENDING_ACCOUNT_CHANGES');
  const scope = client.state.scopes[scopeId];
  if (scope.info.state !== 'active') throw new Error('NATIVE_SYNC.ERROR_MIGRATION_BUSY');
  const { serverId, accountId } = client.account.identity();
  const { device } = client.state;
  const membership = scope.info.members.find(
    (m) => m.authorization.accountId === accountId,
  );
  if (!membership) throw new Error('NATIVE_SYNC.ERROR_NO_PERSONAL');
  // Keep a signed tombstone for every old head omitted by the chosen inventory.
  // A device with an offline edit needs the deletion to preserve that edit as a
  // conflict draft instead of rebasing it onto a missing value.
  const nextIds = new Set(records.map((record) => record.entityId));
  const inventory: RecordChange[] = [
    ...records,
    ...Object.values(client.records(scopeId, true))
      .filter((head) => !nextIds.has(head.entityId))
      .map((head) => ({
        entityId: head.entityId,
        entityType: head.entityType,
        value: null,
        deleted: true,
      })),
  ];
  const batches: Mutation[] = [];
  for (let offset = 0; offset < inventory.length; offset += 100) {
    const mutationId = crypto.randomUUID();
    const counter = scope.counter + batches.length + 1;
    const writes = await Promise.all(
      inventory.slice(offset, offset + 100).map(async (record) => {
        const header = {
          v: 2 as const,
          serverId,
          scopeId,
          entityId: record.entityId,
          entityType: record.entityType,
          actorId: accountId,
          deviceId: device.id,
          mutationId,
          epoch: scope.info.epoch,
          generation: scope.info.generation + 1,
          controlVersion: scope.info.controlVersion,
          counter,
          baseRevision: 0,
          revision: 1,
        };
        return {
          record: await encryptRecord(
            header,
            { value: record.value, deleted: !!record.deleted },
            scope.key,
            device.privateKey,
          ),
          deleted: !!record.deleted,
        };
      }),
    );
    const data = {
      v: 2 as const,
      serverId,
      scopeId,
      epoch: scope.info.epoch,
      generation: scope.info.generation + 1,
      controlVersion: scope.info.controlVersion,
      deviceId: device.id,
      counter,
      mutationId,
      certificate: device.certificate,
      membership,
      writes,
    };
    batches.push({ ...data, signature: await sign(device.privateKey, data) });
  }
  const start = {
    action: 'start-personal-replacement',
    serverId,
    scopeId,
    id: crypto.randomUUID(),
    deviceId: device.id,
    sequence: scope.info.sequence,
    generation: scope.info.generation,
    controlVersion: scope.info.controlVersion,
    count: inventory.length,
    batches: await Promise.all(batches.map((batch) => fingerprint(batch))),
  };
  const ownerKey = client.account.unlocked!.secrets.signingPrivateKey;
  await client.account.request(`/sync/scopes/${scopeId}/replacement/start`, {
    ...start,
    signature: await sign(ownerKey, start),
  });
  for (const mutation of batches)
    await client.account.request(`/sync/scopes/${scopeId}/replacement/stage`, {
      id: start.id,
      mutation,
    });
  const finish = {
    action: 'finish-personal-replacement',
    serverId,
    scopeId,
    id: start.id,
  };
  const commit = {
    ...finish,
    signature: await sign(ownerKey, finish),
  };
  try {
    await client.account.request(`/sync/scopes/${scopeId}/replacement/finish`, commit);
  } catch (error) {
    // A response may have been lost after the atomic commit. The signed request
    // is idempotent, so retrying it never starts a second replacement.
    try {
      await client.account.request(`/sync/scopes/${scopeId}/replacement/finish`, commit);
    } catch {
      throw error;
    }
  }
  await client.syncScope(scopeId);
};
