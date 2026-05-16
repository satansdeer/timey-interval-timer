import assert from "node:assert/strict";
import {
  buildTinyLlmMessages,
  getTinyLlmAssetKey,
  selectModelId,
  validateLlmTimers,
} from "../llm-planner.js";

const defaultTimers = [
  { label: "Warmup", seconds: 300, kind: "warmup" },
  { label: "High intensity", seconds: 60, kind: "work" },
  { label: "Rest", seconds: 60, kind: "rest" },
  { label: "Cooldown", seconds: 300, kind: "cooldown" },
];

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

for (const text of [
  "I want 8 minutes warmup, then 4 alterations of high intensity and low intensity and then 8 minutes cooldown",
  "8 minutes warmup, 6 alterating 1 minute rest / work. then 8 minutes cooldown",
  "8 minute warmup, 8 minutes cooldown. 4 one minute intervals work/rest in the middle (1 minute each)",
  "5 one minute timers and one 30 second",
]) {
  const messages = buildTinyLlmMessages({
    text,
    currentTimers: defaultTimers,
    currentWorkoutShape: {
      intervalCount: 4,
      totalSeconds: 720,
    },
    conversation: [{ role: "assistant", text: "Tell me your warmup, intervals, rests, and cooldown." }],
  });
  const payload = JSON.parse(messages[1].content);

  assert.equal(payload.correctionRequest, false, `${text}: should be a new request`);
  assert.equal("currentTimers" in payload, false, `${text}: should not expose currentTimers`);
  assert.equal("currentWorkoutShape" in payload, false, `${text}: should not expose currentWorkoutShape`);
  assert.equal("conversation" in payload, false, `${text}: should not expose conversation`);
  assert.match(messages[0].content, /Do not copy prior or default timers/);
  assert.match(messages[0].content, /8 minutes is 480/);
  assert.match(messages[0].content, /Never use 8 for an 8-minute timer/);
  assert.match(messages[0].content, /Warmup 480, Work 60, Rest 60, Work 60, Rest 60, Cooldown 480/);
}

const correctionMessages = buildTinyLlmMessages({
  text: "actually make the middle blocks 30 seconds each",
  currentTimers: defaultTimers,
  currentWorkoutShape: {
    intervalCount: 4,
    totalSeconds: 720,
  },
  conversation: [{ role: "user", text: "8 minute warmup, 4 work rest blocks, 8 minute cooldown" }],
});
const correctionPayload = JSON.parse(correctionMessages[1].content);
assert.equal(correctionPayload.correctionRequest, true);
assert.equal(correctionPayload.currentTimers.length, 4);
assert.equal(correctionPayload.currentWorkoutShape.intervalCount, 4);
assert.equal(correctionPayload.conversation.length, 1);

assert.equal(
  selectModelId({
    prebuiltAppConfig: {
      model_list: [
        { model_id: "Other" },
        { model_id: "Qwen2-0.5B-Instruct-q4f16_1-MLC" },
      ],
    },
  }),
  "Qwen2-0.5B-Instruct-q4f16_1-MLC",
);

assert.equal(selectModelId({ prebuiltAppConfig: { model_list: [] } }), "Llama-3.2-1B-Instruct-q4f16_1-MLC");
assert.equal(getTinyLlmAssetKey("Qwen2-0.5B-Instruct-q4f16_1-MLC"), "0.2.83:Qwen2-0.5B-Instruct-q4f16_1-MLC");

console.log("llm planner tests passed");
