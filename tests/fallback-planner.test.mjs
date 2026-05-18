import assert from "node:assert/strict";
import { getWorkoutShape, isCorrection, normalizePrompt, planWithFallback } from "../fallback-planner.js";
import { summarize } from "./helpers.mjs";

const canonical = planWithFallback(
  "Warmup and cooldown 8 minutes each, and between them 8 alterating 1 minute work/rest",
  [],
);
assert.deepEqual(summarize(canonical), {
  count: 18,
  totalSeconds: 1920,
  warmups: 1,
  cooldowns: 1,
  work: 8,
  rest: 8,
  workSeconds: [60],
  restSeconds: [60],
});
assert.deepEqual(getWorkoutShape(canonical.timers), {
  intervalCount: 18,
  totalSeconds: 1920,
  warmup: { label: "Warmup", durationSeconds: 480 },
  cooldown: { label: "Cooldown", durationSeconds: 480 },
  middle: {
    intervalCount: 16,
    cycleCount: 8,
    hasAlternatingPattern: true,
    order: ["work", "rest"],
    startsWith: "work",
    endsWith: "rest",
    workDurationsSeconds: [60],
    restDurationsSeconds: [60],
  },
});

const poorlyArticulated = planWithFallback(
  "Warmup 8 minutes, then 4 alterating rest/high intensity blocks, then 8 minutes warmdown",
  [],
);
assert.deepEqual(summarize(poorlyArticulated), {
  count: 10,
  totalSeconds: 1440,
  warmups: 1,
  cooldowns: 1,
  work: 4,
  rest: 4,
  workSeconds: [60],
  restSeconds: [60],
});
assert.equal(poorlyArticulated.timers[1].kind, "rest");
assert.equal(poorlyArticulated.timers[2].kind, "work");

const highLowAlterations = planWithFallback(
  "I want 8 minutes warmup, then 4 alterations of high intensity and low intensity and then 8 minutes cooldown",
  [],
);
assert.deepEqual(summarize(highLowAlterations), {
  count: 10,
  totalSeconds: 1440,
  warmups: 1,
  cooldowns: 1,
  work: 4,
  rest: 4,
  workSeconds: [60],
  restSeconds: [60],
});
assert.equal(highLowAlterations.timers[1].kind, "work");
assert.equal(highLowAlterations.timers[2].kind, "rest");

const genericTimerList = planWithFallback("5 one minute timers and one 30 second", []);
assert.deepEqual(summarize(genericTimerList), {
  count: 6,
  totalSeconds: 330,
  warmups: 0,
  cooldowns: 0,
  work: 0,
  rest: 0,
  workSeconds: [],
  restSeconds: [],
});
assert.deepEqual(
  genericTimerList.timers.map((timer) => timer.kind),
  ["other", "other", "other", "other", "other", "other"],
);
assert.deepEqual(
  genericTimerList.timers.map((timer) => timer.seconds),
  [60, 60, 60, 60, 60, 30],
);

const positionalGenericList = planWithFallback("first and last timer 5minute, 5 one minute timers in between", []);
assert.deepEqual(
  positionalGenericList.timers.map((timer) => timer.seconds),
  [300, 60, 60, 60, 60, 60, 300],
);
assert.deepEqual(
  positionalGenericList.timers.map((timer) => timer.kind),
  ["other", "other", "other", "other", "other", "other", "other"],
);

const separatedFirstLastList = planWithFallback(
  "first is 1 minute, then five 20 second timers, last is 1 minute",
  [],
);
assert.deepEqual(
  separatedFirstLastList.timers.map((timer) => timer.seconds),
  [60, 20, 20, 20, 20, 20, 60],
);

const firstLastThenMiddleList = planWithFallback(
  "first 4 minutes, last 4 minutes, six 30 second timers in the middle",
  [],
);
assert.deepEqual(
  firstLastThenMiddleList.timers.map((timer) => timer.seconds),
  [240, 30, 30, 30, 30, 30, 30, 240],
);

const commaSeparatedGenericList = planWithFallback("8 minute timer, 4 one minute timers, 8 minute timer", []);
assert.deepEqual(
  commaSeparatedGenericList.timers.map((timer) => timer.seconds),
  [480, 60, 60, 60, 60, 480],
);

const explicitSequence = planWithFallback("8m:Warmup 1m:work 1m30s:rest 8m:Cooldown", []);
assert.deepEqual(summarize(explicitSequence), {
  count: 4,
  totalSeconds: 1110,
  warmups: 1,
  cooldowns: 1,
  work: 1,
  rest: 1,
  workSeconds: [60],
  restSeconds: [90],
});
assert.deepEqual(
  explicitSequence.timers.map((timer) => timer.label),
  ["Warmup", "Work", "Rest", "Cooldown"],
);
assert.deepEqual(
  explicitSequence.timers.map((timer) => timer.seconds),
  [480, 60, 90, 480],
);

const repeatedStepDsl = planWithFallback("2x 2m30s: Step", []);
assert.deepEqual(
  repeatedStepDsl.timers.map((timer) => [timer.label, timer.seconds, timer.kind]),
  [
    ["Step", 150, "other"],
    ["Step", 150, "other"],
  ],
);
assert.deepEqual(
  planWithFallback("please use 2x 2m30s: Step", []).timers.map((timer) => timer.seconds),
  [150, 150],
);

const repeatedBlockDsl = planWithFallback("4x 1m: Rest | 1m: Work", []);
assert.deepEqual(summarize(repeatedBlockDsl), {
  count: 8,
  totalSeconds: 480,
  warmups: 0,
  cooldowns: 0,
  work: 4,
  rest: 4,
  workSeconds: [60],
  restSeconds: [60],
});
assert.deepEqual(
  repeatedBlockDsl.timers.map((timer) => timer.kind),
  ["rest", "work", "rest", "work", "rest", "work", "rest", "work"],
);

const alternatingTotalDsl = planWithFallback("5alt 45s: Rest | 45s: Work", []);
assert.deepEqual(
  alternatingTotalDsl.timers.map((timer) => timer.kind),
  ["rest", "work", "rest", "work", "rest"],
);

const compactWorkoutDsl = planWithFallback("8m: Warmup 8alt 1m: Rest | 1m: Work 8m: Cooldown", []);
assert.deepEqual(summarize(compactWorkoutDsl), {
  count: 10,
  totalSeconds: 1440,
  warmups: 1,
  cooldowns: 1,
  work: 4,
  rest: 4,
  workSeconds: [60],
  restSeconds: [60],
});

const genericRepeatedDsl = planWithFallback("7x 40s: Timer", []);
assert.deepEqual(
  genericRepeatedDsl.timers.map((timer) => [timer.label, timer.seconds, timer.kind]),
  [
    ["Timer 1", 40, "other"],
    ["Timer 2", 40, "other"],
    ["Timer 3", 40, "other"],
    ["Timer 4", 40, "other"],
    ["Timer 5", 40, "other"],
    ["Timer 6", 40, "other"],
    ["Timer 7", 40, "other"],
  ],
);

const middleIntervalsWithDurations = planWithFallback(
  "8 minute warmup, 8 minutes cooldown. 4 one minute intervals work/rest in the middle (1 minute each)",
  [],
);
assert.deepEqual(summarize(middleIntervalsWithDurations), {
  count: 6,
  totalSeconds: 1200,
  warmups: 1,
  cooldowns: 1,
  work: 2,
  rest: 2,
  workSeconds: [60],
  restSeconds: [60],
});
assert.deepEqual(
  middleIntervalsWithDurations.timers.map((timer) => timer.kind),
  ["warmup", "work", "rest", "work", "rest", "cooldown"],
);
assert.deepEqual(
  middleIntervalsWithDurations.timers.map((timer) => timer.seconds),
  [480, 60, 60, 60, 60, 480],
);

const correction = planWithFallback(
  "the alterating blocks shoudl be of 1 minute",
  poorlyArticulated.timers.map((timer) => ({
    ...timer,
    seconds: timer.kind === "warmup" || timer.kind === "cooldown" ? 480 : 90,
  })),
);
assert.deepEqual(summarize(correction), {
  count: 10,
  totalSeconds: 1440,
  warmups: 1,
  cooldowns: 1,
  work: 4,
  rest: 4,
  workSeconds: [60],
  restSeconds: [60],
});

const initialTranscriptPrompt =
  "Warmup 8 minutes, then 4 alterating rest/high intensity blocks, then 8 minutes warmdown";
const wrongCurrentTimers = [
  { label: "Warmup", seconds: 480, kind: "warmup" },
  { label: "Rest", seconds: 480, kind: "rest" },
  { label: "High intensity", seconds: 480, kind: "work" },
  { label: "Rest", seconds: 480, kind: "rest" },
  { label: "High intensity", seconds: 480, kind: "work" },
  { label: "Rest", seconds: 480, kind: "rest" },
  { label: "High intensity", seconds: 480, kind: "work" },
  { label: "Rest", seconds: 480, kind: "rest" },
  { label: "High intensity", seconds: 480, kind: "work" },
];
const middleDurationCorrection = "I wanted the blocks in the middle to be 1 minute each";
const transcriptConversation = [
  { role: "assistant", text: "Ready." },
  { role: "user", text: initialTranscriptPrompt },
  { role: "assistant", text: "9 intervals set." },
  { role: "user", text: middleDurationCorrection },
];
assert.deepEqual(summarize(planWithFallback(middleDurationCorrection, wrongCurrentTimers, transcriptConversation)), {
  count: 10,
  totalSeconds: 1440,
  warmups: 1,
  cooldowns: 1,
  work: 4,
  rest: 4,
  workSeconds: [60],
  restSeconds: [60],
});

const removedBlocksCorrection =
  "you removed all the blocks, i want the blocks like i described them at first but the middle ones should each be 1 minute";
assert.deepEqual(
  summarize(
    planWithFallback(removedBlocksCorrection, [{ label: "Interval", seconds: 60, kind: "other" }], [
      ...transcriptConversation,
      { role: "assistant", text: "1 intervals set." },
      { role: "user", text: removedBlocksCorrection },
    ]),
  ),
  {
    count: 10,
    totalSeconds: 1440,
    warmups: 1,
    cooldowns: 1,
    work: 4,
    rest: 4,
    workSeconds: [60],
    restSeconds: [60],
  },
);

const restWorkTranscriptPrompt =
  "8 minute warmup then 8 alterating 1min cycles of rest/work, then 8 minutes warmdown";
const restWorkPlan = planWithFallback(restWorkTranscriptPrompt, []);
assert.deepEqual(summarize(restWorkPlan), {
  count: 18,
  totalSeconds: 1920,
  warmups: 1,
  cooldowns: 1,
  work: 8,
  rest: 8,
  workSeconds: [60],
  restSeconds: [60],
});
assert.equal(restWorkPlan.timers[1].kind, "rest");
assert.equal(restWorkPlan.timers[2].kind, "work");

const restWorkCorrection = "the alterating cycles must have been 1 minute each, not 8";
assert.deepEqual(
  summarize(
    planWithFallback(
      restWorkCorrection,
      [
        { label: "Warmup", seconds: 480, kind: "warmup" },
        ...Array.from({ length: 8 }).flatMap(() => [
          { label: "Rest", seconds: 480, kind: "rest" },
          { label: "High intensity", seconds: 480, kind: "work" },
        ]),
      ],
      [
        { role: "user", text: restWorkTranscriptPrompt },
        { role: "assistant", text: "17 intervals, 2:16:00 total." },
        { role: "user", text: restWorkCorrection },
      ],
    ),
  ),
  {
    count: 18,
    totalSeconds: 1920,
    warmups: 1,
    cooldowns: 1,
    work: 8,
    rest: 8,
    workSeconds: [60],
    restSeconds: [60],
  },
);

const explicitRestWorkBlocks =
  "Warmup 8 min, then 8 alterating blocks of 1 minute rest 1 minute work, then 8 min cooldown";
const explicitRestWorkPlan = planWithFallback(explicitRestWorkBlocks, []);
assert.deepEqual(summarize(explicitRestWorkPlan), {
  count: 18,
  totalSeconds: 1920,
  warmups: 1,
  cooldowns: 1,
  work: 8,
  rest: 8,
  workSeconds: [60],
  restSeconds: [60],
});
assert.equal(explicitRestWorkPlan.timers[1].kind, "rest");
assert.equal(explicitRestWorkPlan.timers[2].kind, "work");

const typoStepsPlan = planWithFallback(
  "Warmup 8 minu, 8 minutes cooldown. Between 8 steps each 1 minute alterating rest/work",
  [],
);
assert.deepEqual(summarize(typoStepsPlan), {
  count: 10,
  totalSeconds: 1440,
  warmups: 1,
  cooldowns: 1,
  work: 4,
  rest: 4,
  workSeconds: [60],
  restSeconds: [60],
});
assert.equal(typoStepsPlan.timers[1].kind, "rest");
assert.equal(typoStepsPlan.timers[2].kind, "work");

const halvedMiddlePlan = planWithFallback(
  "ah, too many intervals in between, make it twice as little",
  typoStepsPlan.timers,
  [
    {
      role: "user",
      text: "Warmup 8 minu, 8 minutes cooldown. Between 8 steps each 1 minute alterating rest/work",
    },
    { role: "assistant", text: "18 intervals, 32:00 total.", source: "tiny-llm" },
    { role: "user", text: "ah, too many intervals in between, make it twice as little" },
  ],
);
assert.deepEqual(summarize(halvedMiddlePlan), {
  count: 6,
  totalSeconds: 1200,
  warmups: 1,
  cooldowns: 1,
  work: 2,
  rest: 2,
  workSeconds: [60],
  restSeconds: [60],
});
assert.equal(halvedMiddlePlan.timers[1].kind, "rest");
assert.equal(halvedMiddlePlan.timers[2].kind, "work");

const exactSixStepsPrompt =
  "I want to have eight minute warmup eight minutes cool down in between. I want to have exactly 6 steps. Each step should be one minute long and they should alter rest work.";
const exactSixStepsPlan = planWithFallback(exactSixStepsPrompt, []);
assert.deepEqual(summarize(exactSixStepsPlan), {
  count: 8,
  totalSeconds: 1320,
  warmups: 1,
  cooldowns: 1,
  work: 3,
  rest: 3,
  workSeconds: [60],
  restSeconds: [60],
});
assert.equal(exactSixStepsPlan.timers[1].kind, "rest");
assert.equal(exactSixStepsPlan.timers[2].kind, "work");

const exactSixStepsDurationCorrection = "The sixth intervals in the middle should be one minute long";
assert.equal(isCorrection(normalizePrompt(exactSixStepsDurationCorrection)), true);
assert.equal(
  isCorrection(normalizePrompt("first and final timers should be 90 seconds, put 4 twenty second timers between them")),
  false,
);
assert.deepEqual(
  summarize(
    planWithFallback(
      exactSixStepsDurationCorrection,
      exactSixStepsPlan.timers.map((timer) => ({
        ...timer,
        seconds: timer.kind === "warmup" || timer.kind === "cooldown" ? 480 : 480,
      })),
      [
        { role: "user", text: exactSixStepsPrompt },
        { role: "assistant", text: "14 intervals, 1:52:00 total." },
        { role: "user", text: exactSixStepsDurationCorrection },
      ],
    ),
  ),
  {
    count: 8,
    totalSeconds: 1320,
    warmups: 1,
    cooldowns: 1,
    work: 3,
    rest: 3,
    workSeconds: [60],
    restSeconds: [60],
  },
);

const exactSixStepsRestatement =
  "you got me wrong I wanted to have eight minute warmup eight minutes cooldown and six step stick six steps in the middle one minute each alternating between work and rest";
assert.deepEqual(summarize(planWithFallback(exactSixStepsRestatement, [])), {
  count: 8,
  totalSeconds: 1320,
  warmups: 1,
  cooldowns: 1,
  work: 3,
  rest: 3,
  workSeconds: [60],
  restSeconds: [60],
});

console.log("fallback planner tests passed");
