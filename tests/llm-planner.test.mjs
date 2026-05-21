import assert from "node:assert/strict";
import {
  TRAINED_TINY_MODEL_ID,
  TRAINED_TINY_MODEL_VERSION,
  TRANSFORMERS_PACKAGE_VERSION,
  TINY_TIMER_INPUT_PREFIX,
  buildTinyLlmInput,
  buildTinyLlmRequest,
  getTinyLlmAssetKey,
  parseDirectTimerDslInput,
  repairGenericTimerList,
  validateLlmTimers,
} from "../llm-planner.js";

const tinyRequest = buildTinyLlmRequest("8 minutes warmup");
assert.equal(buildTinyLlmInput("8 minutes warmup"), tinyRequest.input);
assert.match(tinyRequest.input, new RegExp(`^${TINY_TIMER_INPUT_PREFIX}Request: 8 minutes warmup\\nCounts: none\\n`));
assert.match(tinyRequest.input, /Atoms: A0@0:9=8m:Timer; A1@0:9,10:16=8m:Warmup/);
assert.equal(tinyRequest.slots.atoms[1].value, "8m");
assert.equal(tinyRequest.slots.atoms[1].label, "Warmup");

assert.deepEqual(
  validateLlmTimers([
    { label: "Warmup", durationSeconds: 480, kind: "warmup" },
    { label: "Rest", seconds: 60, kind: "rest" },
  ]),
  [
    { label: "Warmup", seconds: 480, kind: "warmup" },
    { label: "Rest", seconds: 60, kind: "rest" },
  ],
);

assert.throws(
  () => validateLlmTimers([{ label: "Bad", durationSeconds: 0, kind: "work" }]),
  /invalid duration/,
);
assert.throws(
  () => validateLlmTimers([{ label: "Bad", durationSeconds: 60, kind: "sprint" }]),
  /invalid interval kind/,
);

assert.equal(
  getTinyLlmAssetKey(TRAINED_TINY_MODEL_ID),
  `${TRANSFORMERS_PACKAGE_VERSION}:${TRAINED_TINY_MODEL_VERSION}:${TRAINED_TINY_MODEL_ID}`,
);

assert.deepEqual(
  parseDirectTimerDslInput("30 seconds: Plank, 45 seconds: Squats, 1 minute: Rest").timers,
  [
    { label: "Plank", seconds: 30, kind: "other" },
    { label: "Squats", seconds: 45, kind: "other" },
    { label: "Rest", seconds: 60, kind: "rest" },
  ],
);
assert.equal(parseDirectTimerDslInput("ten one minute timers"), null);

assert.deepEqual(
  repairGenericTimerList("5 one minute timers and one 30 second", [
    { label: "Timer 1", seconds: 60, kind: "other" },
    { label: "Timer 2", seconds: 60, kind: "other" },
    { label: "Timer 3", seconds: 60, kind: "other" },
    { label: "Timer 4", seconds: 60, kind: "other" },
    { label: "Timer 5", seconds: 60, kind: "other" },
    { label: "Timer 6", seconds: 60, kind: "other" },
    { label: "Timer 7", seconds: 60, kind: "other" },
    { label: "Timer 8", seconds: 60, kind: "other" },
    { label: "Timer 9", seconds: 60, kind: "other" },
    { label: "Timer 10", seconds: 60, kind: "other" },
  ]).map((timer) => timer.seconds),
  [60, 60, 60, 60, 60, 30],
);

assert.deepEqual(
  repairGenericTimerList("first and last timer 5minute, 5 one minute timers in between", [
    { label: "Timer 1", seconds: 300, kind: "other" },
  ]).map((timer) => timer.seconds),
  [300, 60, 60, 60, 60, 60, 300],
);

assert.deepEqual(
  repairGenericTimerList("8 minute timer, 4 one minute timers, 8 minute timer", [
    { label: "Timer 1", seconds: 480, kind: "other" },
    { label: "Timer 2", seconds: 60, kind: "other" },
    { label: "Timer 3", seconds: 60, kind: "other" },
    { label: "Timer 4", seconds: 60, kind: "other" },
    { label: "Timer 5", seconds: 60, kind: "other" },
  ]).map((timer) => timer.seconds),
  [480, 60, 60, 60, 60, 480],
);

assert.deepEqual(
  repairGenericTimerList("plain timers only: 5 minutes, then five timers of 1 minute, then 5 minutes", [
    { label: "Timer 1", seconds: 300, kind: "other" },
    { label: "Timer 2", seconds: 60, kind: "other" },
  ]).map((timer) => timer.seconds),
  [300, 60, 60, 60, 60, 60, 300],
);

assert.deepEqual(
  repairGenericTimerList("timer sequence for practice: one 3 minutes, 5 short 15 seconds timers, one 4 minutes", [
    { label: "Timer 1", seconds: 180, kind: "other" },
    { label: "Timer 2", seconds: 15, kind: "other" },
  ]).map((timer) => timer.seconds),
  [180, 15, 15, 15, 15, 15, 240],
);

assert.deepEqual(
  repairGenericTimerList("1 min 15 sec once, 15 seconds six times, 75 seconds once, all plain timers", [
    { label: "Timer 1", seconds: 75, kind: "other" },
  ]).map((timer) => timer.seconds),
  [75, 15, 15, 15, 15, 15, 15, 75],
);

const warmupLikeModelTimers = [
  { label: "Warmup", seconds: 300, kind: "warmup" },
  { label: "Timer", seconds: 60, kind: "other" },
];
assert.deepEqual(
  repairGenericTimerList("5 one minute timers", warmupLikeModelTimers).map((timer) => [timer.seconds, timer.kind]),
  [
    [60, "other"],
    [60, "other"],
    [60, "other"],
    [60, "other"],
    [60, "other"],
  ],
);

assert.deepEqual(
  repairGenericTimerList("one 5 minute timer and one 1 minute timer", warmupLikeModelTimers).map((timer) => [
    timer.seconds,
    timer.kind,
  ]),
  [
    [300, "other"],
    [60, "other"],
  ],
);

console.log("llm planner tests passed");
