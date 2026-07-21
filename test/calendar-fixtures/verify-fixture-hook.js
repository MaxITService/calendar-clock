const assert = require("assert");
const hook = require("./page-owned-fixture-hook.js");

const fixtureTitle = "[CC FIXTURE v1 2026-07-13] Bootstrap";
const eventId = "0123456789abcdefghijklmnop";
const startMs = Date.parse("2026-07-13T06:00:00.000Z");
const endMs = Date.parse("2026-07-13T06:10:00.000Z");
const event = [eventId, null, null, [
  [null, [null, fixtureTitle]],
  [null, null, [null, "calendar-clock-fixture:v1"]],
  [[null, [null, [startMs]], [null, [endMs]], null, null, "2026b"]]
]];
const createOperation = [7, null, [[null, null, event]], null, null, 8];
const createData = [[[], "sync-token", null, null, [createOperation], null, null, [], null, [[5, 8, null, [1]]]], 20000];
const createBody = new URLSearchParams({ "f.req": JSON.stringify(createData), secid: "fixture" }).toString();
const createTemplate = hook.parseSyncMutationRequest(
  "https://calendar.google.com/calendar/u/0/sync.sync",
  "POST",
  createBody
);
assert.strictEqual(createTemplate.kind, "create");

let randomByte = 0;
const batch = hook.buildCreateBatch(createTemplate, [
  { title: "[CC FIXTURE v1 2026-07-13] A", startMs: startMs + 600000, endMs: endMs + 600000 },
  { title: "[CC FIXTURE v1 2026-07-13] B", startMs: startMs + 1200000, endMs: endMs + 1200000 }
], bytes => bytes.fill(randomByte++));
assert.strictEqual(batch[0][4].length, 2);
assert.strictEqual(batch[0][4][0][5], 9);
assert.strictEqual(batch[0][4][1][5], 10);
assert.match(JSON.stringify(batch[0][4][0]), /2026-07-13\] A/);
assert.match(JSON.stringify(batch[0][4][1]), /2026-07-13\] B/);

const deleteOperation = [11, null, [[null, [eventId, null, null, [[null]], 0]], "calendar@example.com"], null, null, 12];
const deleteData = [[[], "sync-token", null, null, [deleteOperation], null, null, [], null, [[7, 12, null, [1]]]], 20000];
const deleteTemplate = hook.parseSyncMutationRequest(
  "https://calendar.google.com/calendar/u/0/sync.sync",
  "POST",
  new URLSearchParams({ "f.req": JSON.stringify(deleteData), secid: "fixture" }).toString()
);
assert.strictEqual(deleteTemplate.kind, "delete");
const deleteBatch = hook.buildDeleteBatch(deleteTemplate, [eventId, "vutsrqponmlkjihgfedcba9876"]);
assert.strictEqual(deleteBatch[0][4].length, 2);
assert.strictEqual(deleteBatch[0][4][0][5], 13);
assert.strictEqual(deleteBatch[0][4][1][5], 14);
assert.match(JSON.stringify(deleteBatch[0][4][1]), /vutsrqponmlkjihgfedcba9876/);

assert.strictEqual(
  hook.decodeDomEventId(Buffer.from(`${eventId} calendar@example.com`).toString("base64").replace(/=+$/, "")),
  eventId
);
assert.throws(() => hook.buildDeleteBatch(deleteTemplate, ["unsafe"]), /Unsafe Calendar event ID/);
console.log("Calendar fixture hook verification passed.");
