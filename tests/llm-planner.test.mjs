import assert from "node:assert/strict";
import { getTinyLlmAssetKey, selectModelId, validateLlmTimers } from "../llm-planner.js";

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
