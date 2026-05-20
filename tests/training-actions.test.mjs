import assert from "node:assert/strict";
import {
  buildTimerSftExamples,
  compareTimerOutputs,
  extractLosslessActionSlots,
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

const losslessSlots = extractLosslessActionSlots("first and last timer 5minute, 5 one minute timers in between");
assert.deepEqual(
  losslessSlots.durations.map((slot) => `${slot.id}@${slot.spans.map((span) => `${span.start}:${span.end}`).join(",") || slot.source}=${slot.value}`),
  ["D0@21:28=5m", "D1@32:42=1m"],
);
assert.deepEqual(
  losslessSlots.counts.map((slot) => `${slot.id}@${slot.spans.map((span) => `${span.start}:${span.end}`).join(",")}=${slot.count}`),
  ["C0@30:31=5"],
);
assert.deepEqual(losslessSlots.labels.map((slot) => `${slot.id}@${slot.source}=${slot.label}`), ["L0@default=Timer"]);

const losslessRecords = buildTimerSftExamples({
  targetFormat: "actions",
  userFormat: "lossless-slots",
  includePhase4HardData: true,
  includeUserRequestExpansion: true,
});
const losslessRecord = losslessRecords.find(
  (record) => record.metadata.userRequest === "first and last timer 5minute, 5 one minute timers in between",
);
assert.ok(losslessRecord);
assert.match(losslessRecord.messages[1].content, /^Request: first and last timer 5minute, 5 one minute timers in between\nSlots: /);
assert.match(losslessRecord.messages[1].content, /D0@21:28=5m/);
assert.match(losslessRecord.messages[1].content, /D1@32:42=1m/);
assert.match(losslessRecord.messages[1].content, /C0@30:31=5/);
assert.equal(losslessRecord.messages[2].content, "ADD D0 L0\nREP C0 D1 L0\nADD D0 L0\nEND");
assert.deepEqual(
  compareTimerOutputs(
    losslessRecord.metadata.expectedTimers,
    parseTimerActions(losslessRecord.messages[2].content, losslessRecord.metadata.actionSlots).timers,
  ),
  [],
);

const losslessAtomRecords = buildTimerSftExamples({
  targetFormat: "actions",
  userFormat: "lossless-atoms",
  includePhase4HardData: true,
  includeUserRequestExpansion: true,
});
const losslessAtomRecord = losslessAtomRecords.find(
  (record) => record.metadata.userRequest === "first and last timer 5minute, 5 one minute timers in between",
);
assert.ok(losslessAtomRecord);
assert.match(losslessAtomRecord.messages[1].content, /^Request: first and last timer 5minute, 5 one minute timers in between\nCounts: /);
assert.match(losslessAtomRecord.messages[1].content, /Atoms: A0@21:28=5m:Timer; A1@32:42=1m:Timer/);
assert.equal(losslessAtomRecord.messages[2].content, "ADD A0\nREP C0 A1\nADD A0\nEND");
assert.deepEqual(
  compareTimerOutputs(
    losslessAtomRecord.metadata.expectedTimers,
    parseTimerActions(losslessAtomRecord.messages[2].content, losslessAtomRecord.metadata.actionSlots).timers,
  ),
  [],
);

const atomSequenceRecord = losslessAtomRecords.find(
  (record) => record.metadata.userRequest === "30 seconds: Plank, 45 seconds: Squats, 1 minute: Rest",
);
assert.ok(atomSequenceRecord);
assert.equal(atomSequenceRecord.messages[2].content, "SEQ A0 A2 A4\nEND");
assert.deepEqual(
  compareTimerOutputs(
    atomSequenceRecord.metadata.expectedTimers,
    parseTimerActions(atomSequenceRecord.messages[2].content, atomSequenceRecord.metadata.actionSlots).timers,
  ),
  [],
);

const losslessItemRecords = buildTimerSftExamples({
  targetFormat: "actions",
  userFormat: "lossless-items",
  includePhase4HardData: true,
  includeUserRequestExpansion: true,
});
const losslessItemRecord = losslessItemRecords.find(
  (record) => record.metadata.userRequest === "8 minute timer, 4 one minute timers, 8 minute timer",
);
assert.ok(losslessItemRecord);
assert.match(losslessItemRecord.messages[1].content, /^Request: 8 minute timer, 4 one minute timers, 8 minute timer\nCounts: /);
assert.match(losslessItemRecord.messages[1].content, /Items: I0@0:8=8m:Timer; I1@18:28=1m:Timer; I2@37:45=8m:Timer/);
assert.equal(losslessItemRecord.messages[2].content, "ADD I0\nREP C0 I1\nADD I2\nEND");
assert.deepEqual(
  compareTimerOutputs(
    losslessItemRecord.metadata.expectedTimers,
    parseTimerActions(losslessItemRecord.messages[2].content, losslessItemRecord.metadata.actionSlots).timers,
  ),
  [],
);

const itemSequenceRecord = losslessItemRecords.find(
  (record) => record.metadata.userRequest === "30 seconds: Plank, 45 seconds: Squats, 1 minute: Rest",
);
assert.ok(itemSequenceRecord);
assert.match(itemSequenceRecord.messages[1].content, /Items: I0@0:10,12:17=30s:Plank; I1@19:29,31:37=45s:Squats; I2@39:47,49:53=1m:Rest/);
assert.equal(itemSequenceRecord.messages[2].content, "SEQ I0 I1 I2\nEND");
assert.deepEqual(
  compareTimerOutputs(
    itemSequenceRecord.metadata.expectedTimers,
    parseTimerActions(itemSequenceRecord.messages[2].content, itemSequenceRecord.metadata.actionSlots).timers,
  ),
  [],
);

const hybridItemAtomRecords = buildTimerSftExamples({
  targetFormat: "actions",
  userFormat: "lossless-item-atoms",
  includePhase4HardData: true,
  includeUserRequestExpansion: true,
});
const hybridSequenceRecord = hybridItemAtomRecords.find(
  (record) => record.metadata.userRequest === "30 seconds: Plank, 45 seconds: Squats, 1 minute: Rest",
);
assert.ok(hybridSequenceRecord);
assert.match(hybridSequenceRecord.messages[1].content, /Items: I0@0:10,12:17=30s:Plank; I1@19:29,31:37=45s:Squats; I2@39:47,49:53=1m:Rest/);
assert.match(hybridSequenceRecord.messages[1].content, /Atoms: A0@0:10,12:17=30s:Plank/);
assert.equal(hybridSequenceRecord.messages[2].content, "SEQ I0 I1 I2\nEND");
assert.deepEqual(
  compareTimerOutputs(
    hybridSequenceRecord.metadata.expectedTimers,
    parseTimerActions(hybridSequenceRecord.messages[2].content, hybridSequenceRecord.metadata.actionSlots).timers,
  ),
  [],
);

const hybridGenericRecord = hybridItemAtomRecords.find(
  (record) => record.metadata.userRequest === "8 minute timer, 4 one minute timers, 8 minute timer",
);
assert.ok(hybridGenericRecord);
assert.equal(hybridGenericRecord.messages[2].content, "ADD A0\nREP C0 A1\nADD A0\nEND");
assert.deepEqual(
  compareTimerOutputs(
    hybridGenericRecord.metadata.expectedTimers,
    parseTimerActions(hybridGenericRecord.messages[2].content, hybridGenericRecord.metadata.actionSlots).timers,
  ),
  [],
);

console.log("training action target tests passed");
