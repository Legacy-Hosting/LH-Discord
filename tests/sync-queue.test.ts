import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createRoleSyncQueue,
  type SyncAuditEvent,
  type SyncAuditWriter,
  type SyncQueueStore,
} from "../src/sync-queue.js";

function memoryPersistence() {
  let value: Parameters<SyncQueueStore["save"]>[0] = {
    version: 1,
    entries: [],
  };
  const audit: SyncAuditEvent[] = [];
  const store: SyncQueueStore = {
    async load() {
      return structuredClone(value);
    },
    async save(next) {
      value = structuredClone(next);
    },
  };
  const writer: SyncAuditWriter = {
    async append(event) {
      audit.push(structuredClone(event));
    },
  };
  return { store, writer, audit };
}

const payload = {
  discordUserId: "11111111111111111",
  discordGuildId: "22222222222222222",
  staffRoles: ["support" as const],
};

test("failed role syncs persist and retry with exponential backoff", async () => {
  let timestamp = Date.parse("2026-09-27T10:00:00.000Z");
  let providerAvailable = false;
  let calls = 0;
  const persistence = memoryPersistence();
  const queue = createRoleSyncQueue({
    sync: async () => {
      calls += 1;
      if (!providerAvailable) throw new Error("secret upstream response");
    },
    store: persistence.store,
    audit: persistence.writer,
    pollIntervalMs: 1_000,
    retryBaseMs: 5_000,
    retryMaxMs: 60_000,
    maxAttempts: 4,
    now: () => timestamp,
  });

  assert.equal(await queue.restore(), 0);
  assert.equal(await queue.synchronize(payload), "queued");
  assert.equal(calls, 1);
  const pending = queue.pending()[0];
  assert.ok(pending);
  assert.equal(pending.attempts, 1);
  assert.equal(
    pending.nextAttemptAt,
    "2026-09-27T10:00:05.000Z",
  );
  assert.equal(await queue.processDue(), 0);

  timestamp += 5_000;
  providerAvailable = true;
  assert.equal(await queue.processDue(), 1);
  assert.equal(calls, 2);
  assert.deepEqual(queue.pending(), []);
  assert.deepEqual(
    persistence.audit.map((event) => event.event),
    ["retry_scheduled", "succeeded"],
  );
  assert.equal(JSON.stringify(persistence.audit).includes("secret upstream"), false);
});

test("manual synchronization resets an abandoned entry and keeps the latest roles", async () => {
  let providerAvailable = false;
  const synchronizedRoles: string[][] = [];
  const persistence = memoryPersistence();
  const queue = createRoleSyncQueue({
    sync: async (next) => {
      synchronizedRoles.push([...next.staffRoles]);
      if (!providerAvailable) throw new TypeError("provider unavailable");
    },
    store: persistence.store,
    audit: persistence.writer,
    pollIntervalMs: 1_000,
    retryBaseMs: 1_000,
    retryMaxMs: 10_000,
    maxAttempts: 1,
    now: () => Date.parse("2026-09-27T10:00:00.000Z"),
  });

  await queue.restore();
  assert.equal(await queue.synchronize(payload), "abandoned");
  assert.equal(queue.pending()[0]?.nextAttemptAt, null);

  providerAvailable = true;
  assert.equal(await queue.synchronize({
    ...payload,
    staffRoles: ["sales"],
  }), "synchronized");
  assert.deepEqual(queue.pending(), []);
  assert.deepEqual(synchronizedRoles, [["support"], ["sales"]]);
  assert.deepEqual(
    persistence.audit.map((event) => event.event),
    ["abandoned", "succeeded"],
  );
});
