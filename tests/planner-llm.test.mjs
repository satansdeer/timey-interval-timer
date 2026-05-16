import assert from "node:assert/strict";
import { planTimers } from "../planner.js";

const defaultTimerCopy = {
  source: "tiny-llm",
  model: "test-model",
  timers: [
    { label: "Warmup", seconds: 300, kind: "warmup" },
    { label: "High intensity", seconds: 60, kind: "work" },
    { label: "Rest", seconds: 60, kind: "rest" },
    { label: "Cooldown", seconds: 300, kind: "cooldown" },
  ],
};

const copiedLlmPlan = await planTimers({
  text: "8 minutes warmup, 6 alterating 1 minute rest / work. then 8 minutes cooldown",
  currentTimers: defaultTimerCopy.timers,
  conversation: [],
  useTinyLlm: true,
  planWithTinyLlmImpl: async () => defaultTimerCopy,
});
assert.equal(copiedLlmPlan.source, "tiny-llm");
assert.equal(copiedLlmPlan.model, "test-model");
assert.deepEqual(copiedLlmPlan.timers, defaultTimerCopy.timers);

const unavailableFallbackPlan = await planTimers({
  text: "5 one minute timers and one 30 second",
  currentTimers: defaultTimerCopy.timers,
  conversation: [],
  useTinyLlm: true,
  planWithTinyLlmImpl: async () => {
    throw new Error("Tiny LLM unavailable");
  },
});
assert.equal(unavailableFallbackPlan.source, "fallback");
assert.match(unavailableFallbackPlan.fallbackReason, /Tiny LLM unavailable/);
assert.deepEqual(
  unavailableFallbackPlan.timers.map((timer) => timer.seconds),
  [60, 60, 60, 60, 60, 30],
);

await assert.rejects(
  planTimers({
    text: "5 one minute timers and one 30 second",
    currentTimers: defaultTimerCopy.timers,
    conversation: [],
    useTinyLlm: true,
    planWithTinyLlmImpl: async () => {
      throw new Error("Tiny LLM returned an invalid duration");
    },
  }),
  /invalid duration/,
);

console.log("planner LLM path tests passed");
