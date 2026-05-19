import assert from "node:assert/strict";
import {
  buildTimerSftExamples,
  compareTimerOutputs,
  parseTimerActions,
} from "../scripts/training/timer-sft-lib.mjs";

const records = buildTimerSftExamples({
  targetFormat: "actions",
  userFormat: "natural",
  dslEndToken: true,
});

const genericRecord = records.find(
  (record) => record.metadata.userRequest === "5 one minute timers and one 30 second",
);
assert.ok(genericRecord);
assert.match(genericRecord.messages[1].content, /Slots: D0=1m; D1=30s; C0=5; L0=Timer/);
assert.equal(genericRecord.messages[2].content, "REP C0 D0 L0\nADD D1 L0\nEND");
assert.deepEqual(
  compareTimerOutputs(
    genericRecord.metadata.expectedTimers,
    parseTimerActions(genericRecord.messages[2].content, genericRecord.metadata.actionSlots).timers,
  ),
  [],
);

const intervalRecord = records.find((record) =>
  record.metadata.userRequest.startsWith("Please make warmup 12 minutes"),
);
assert.ok(intervalRecord);
assert.match(intervalRecord.messages[2].content, /^ADD D0 L0\nALT C0 D1 L1 D1 L2\nADD D2 L3\nEND$/);
assert.deepEqual(
  compareTimerOutputs(
    intervalRecord.metadata.expectedTimers,
    parseTimerActions(intervalRecord.messages[2].content, intervalRecord.metadata.actionSlots).timers,
  ),
  [],
);

console.log("training action target tests passed");
