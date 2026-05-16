import assert from "node:assert/strict";
import { planWithFallback } from "../fallback-planner.js";
import { shouldUseFallbackPlan } from "../planner.js";

const explicitRestWorkBlocks =
  "Warmup 8 min, then 8 alterating blocks of 1 minute rest 1 minute work, then 8 min cooldown";
const explicitRestWorkPlan = planWithFallback(explicitRestWorkBlocks, []);

assert.equal(
  shouldUseFallbackPlan(
    explicitRestWorkBlocks,
    {
      source: "tiny-llm",
      timers: [
        { label: "Warmup", seconds: 480, kind: "warmup" },
        { label: "Rest", seconds: 60, kind: "rest" },
        { label: "Work", seconds: 60, kind: "work" },
        { label: "Cooldown", seconds: 120, kind: "cooldown" },
      ],
    },
    explicitRestWorkPlan,
  ),
  true,
);

assert.equal(
  shouldUseFallbackPlan(explicitRestWorkBlocks, explicitRestWorkPlan, explicitRestWorkPlan),
  false,
);

assert.equal(
  shouldUseFallbackPlan(
    "set a 1 minute timer",
    {
      source: "tiny-llm",
      timers: [{ label: "Interval", seconds: 60, kind: "other" }],
    },
    planWithFallback("set a 1 minute timer", []),
  ),
  false,
);

const typoStepsPrompt =
  "Warmup 8 minu, 8 minutes cooldown. Between 8 steps each 1 minute alterating rest/work";
assert.equal(
  shouldUseFallbackPlan(
    typoStepsPrompt,
    {
      source: "tiny-llm",
      timers: [
        { label: "Warmup", seconds: 300, kind: "warmup" },
        { label: "Rest", seconds: 60, kind: "rest" },
        { label: "Work", seconds: 60, kind: "work" },
      ],
    },
    planWithFallback(typoStepsPrompt, []),
  ),
  true,
);

const exactSixStepsPrompt =
  "I want to have eight minute warmup eight minutes cool down in between. I want to have exactly 6 steps. Each step should be one minute long and they should alter rest work.";
assert.equal(
  shouldUseFallbackPlan(
    exactSixStepsPrompt,
    {
      source: "tiny-llm",
      timers: [
        { label: "Warmup", seconds: 480, kind: "warmup" },
        ...Array.from({ length: 6 }).flatMap(() => [
          { label: "Rest", seconds: 480, kind: "rest" },
          { label: "Work", seconds: 480, kind: "work" },
        ]),
        { label: "Cooldown", seconds: 480, kind: "cooldown" },
      ],
    },
    planWithFallback(exactSixStepsPrompt, []),
  ),
  true,
);

const halvedMiddlePrompt = "ah, too many intervals in between, make it twice as little";
const halvedMiddleFallback = planWithFallback(
  halvedMiddlePrompt,
  planWithFallback(typoStepsPrompt, []).timers,
);
assert.equal(
  shouldUseFallbackPlan(
    halvedMiddlePrompt,
    {
      source: "tiny-llm",
      timers: [
        { label: "Warmup", seconds: 480, kind: "warmup" },
        ...Array.from({ length: 8 }).flatMap(() => [
          { label: "Rest", seconds: 60, kind: "rest" },
          { label: "Work", seconds: 60, kind: "work" },
        ]),
        { label: "Cooldown", seconds: 480, kind: "cooldown" },
      ],
    },
    halvedMiddleFallback,
  ),
  true,
);

console.log("planner guard tests passed");
