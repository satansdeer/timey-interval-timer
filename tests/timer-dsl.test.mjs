import assert from "node:assert/strict";
import {
  getTimerDslPrefixState,
  isCompleteTimerDsl,
  isTimerDslHardInvalidPrefix,
  isTimerDslPrefix,
  parseTimerDsl,
} from "../timer-dsl.js";

assert.deepEqual(parseTimerDsl("2x 2m30s: Step").timers, [
  { label: "Step", durationSeconds: 150, kind: "other" },
  { label: "Step", durationSeconds: 150, kind: "other" },
]);

assert.deepEqual(parseTimerDsl("2x2m30s: Step").timers, [
  { label: "Step", durationSeconds: 150, kind: "other" },
  { label: "Step", durationSeconds: 150, kind: "other" },
]);

assert.deepEqual(parseTimerDsl("4m around 5x30s: Timer").timers.map(({ label, durationSeconds, kind }) => [
  label,
  durationSeconds,
  kind,
]), [
  ["Timer 1", 240, "other"],
  ["Timer 2", 30, "other"],
  ["Timer 3", 30, "other"],
  ["Timer 4", 30, "other"],
  ["Timer 5", 30, "other"],
  ["Timer 6", 30, "other"],
  ["Timer 7", 240, "other"],
]);

assert.deepEqual(parseTimerDsl("30s + 5x10s + 1m: Timer").timers.map(({ label, durationSeconds, kind }) => [
  label,
  durationSeconds,
  kind,
]), [
  ["Timer 1", 30, "other"],
  ["Timer 2", 10, "other"],
  ["Timer 3", 10, "other"],
  ["Timer 4", 10, "other"],
  ["Timer 5", 10, "other"],
  ["Timer 6", 10, "other"],
  ["Timer 7", 60, "other"],
]);

assert.deepEqual(parseTimerDsl("1m: Run around, 30s: Warm + Cool").timers, [
  { label: "Run around", durationSeconds: 60, kind: "other" },
  { label: "Warm + Cool", durationSeconds: 30, kind: "warmup" },
]);

assert.throws(() => parseTimerDsl("4m around 5x30s: Warmup"), /must use Timer/);
assert.throws(() => parseTimerDsl("12m around 5alt 45s: Rest | 45s: Work"), /cannot contain alt|expected duration|must use Timer/);

assert.deepEqual(parseTimerDsl("4x 1m: Rest | 1m: Work").timers.map(({ label, durationSeconds, kind }) => [
  label,
  durationSeconds,
  kind,
]), [
  ["Rest", 60, "rest"],
  ["Work", 60, "work"],
  ["Rest", 60, "rest"],
  ["Work", 60, "work"],
  ["Rest", 60, "rest"],
  ["Work", 60, "work"],
  ["Rest", 60, "rest"],
  ["Work", 60, "work"],
]);

assert.deepEqual(parseTimerDsl("5alt 45s: Rest | 45s: Work").timers.map((timer) => timer.label), [
  "Rest",
  "Work",
  "Rest",
  "Work",
  "Rest",
]);

assert.deepEqual(
  parseTimerDsl("8m: Warmup 8alt 1m: Rest | 1m: Work 8m: Cooldown END").timers.map(
    ({ label, durationSeconds, kind }) => [label, durationSeconds, kind],
  ),
  [
    ["Warmup", 480, "warmup"],
    ["Rest", 60, "rest"],
    ["Work", 60, "work"],
    ["Rest", 60, "rest"],
    ["Work", 60, "work"],
    ["Rest", 60, "rest"],
    ["Work", 60, "work"],
    ["Rest", 60, "rest"],
    ["Work", 60, "work"],
    ["Cooldown", 480, "cooldown"],
  ],
);

assert.deepEqual(parseTimerDsl("7x 40s: Timer").timers.map((timer) => timer.label), [
  "Timer 1",
  "Timer 2",
  "Timer 3",
  "Timer 4",
  "Timer 5",
  "Timer 6",
  "Timer 7",
]);

assert.deepEqual(parseTimerDsl("30s: Plank,45s: Squats; 1m: Rest").timers, [
  { label: "Plank", durationSeconds: 30, kind: "other" },
  { label: "Squats", durationSeconds: 45, kind: "other" },
  { label: "Rest", durationSeconds: 60, kind: "rest" },
]);

for (const prefix of [
  "",
  "8",
  "8m",
  "8m:",
  "8m: ",
  "8m: Warm",
  "8m: Warmup\n",
  "8m: Warmup\n4",
  "8m: Warmup 4x",
  "4x",
  "4x ",
  "4m around",
  "4m aroun",
  "4m +",
  "4m + 5x",
  "4x 1m: Rest |",
  "4x 1m: Rest | 1",
  "4x 1m: Rest | 1m:",
  "8m: Warmup E",
  "8m: Warmup EN",
]) {
  assert.equal(isTimerDslPrefix(prefix), true, `${JSON.stringify(prefix)} should be a valid prefix`);
}

for (const invalidPrefix of ["Warmup", "x 1m: Timer", "8m Warmup", "1m: Rest | abc"]) {
  assert.equal(isTimerDslPrefix(invalidPrefix), false, `${JSON.stringify(invalidPrefix)} should be invalid`);
}

for (const hardInvalidPrefix of [
  "12m around 5alt",
  "12m around 5alt 45s",
  "12m around 5x45s: R",
  "12m around 5x45s: Rest | 45s: Work",
  "30s + 5x10s + 1m: Warmup",
]) {
  assert.equal(
    isTimerDslHardInvalidPrefix(hardInvalidPrefix),
    true,
    `${JSON.stringify(hardInvalidPrefix)} should be a hard invalid prefix`,
  );
  assert.equal(isTimerDslPrefix(hardInvalidPrefix), false, `${JSON.stringify(hardInvalidPrefix)} should be invalid`);
}

for (const allowedGroupedPrefix of [
  "4m around",
  "4m around 5x30s:",
  "4m around 5x30s: T",
  "4m around 5x30s: Timer",
  "30s + 5x10s + 1m: Tim",
  "1m: Run around",
]) {
  assert.equal(
    isTimerDslHardInvalidPrefix(allowedGroupedPrefix),
    false,
    `${JSON.stringify(allowedGroupedPrefix)} should not be a hard invalid prefix`,
  );
  assert.equal(isTimerDslPrefix(allowedGroupedPrefix), true, `${JSON.stringify(allowedGroupedPrefix)} should be valid`);
}

assert.equal(isCompleteTimerDsl("8m: Warmup"), true);
assert.equal(isCompleteTimerDsl("8m: Warmup END"), true);
assert.equal(isCompleteTimerDsl("8m: Warmup E"), false);
assert.equal(isCompleteTimerDsl("8m: Warmup 4"), false);
assert.equal(isCompleteTimerDsl("4m around 5x30s: Warmup"), false);
assert.deepEqual(getTimerDslPrefixState("4x 1m: Rest |").reason, "completion");
assert.deepEqual(getTimerDslPrefixState("12m around 5alt").reason, "semantic-invalid");

console.log("timer DSL tests passed");
