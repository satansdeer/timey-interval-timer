import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultState, submitAssistantText } from "../assistant-session.js";

const fixtures = JSON.parse(
  await readFile(resolve("tests/assistant-dialog-fixtures.json"), "utf8"),
);

for (const fixture of fixtures) {
  const state = defaultState();

  for (const [turnIndex, turn] of fixture.turns.entries()) {
    await submitAssistantText({ state, text: turn.user });
    assertExpectation(
      summarizeTimers(state.timers),
      turn.expect,
      `${fixture.name} turn ${turnIndex + 1}`,
    );
  }
}

console.log("assistant session fixture tests passed");

function summarizeTimers(timers) {
  const middle = timers.filter((timer) => timer.kind === "work" || timer.kind === "rest");
  return {
    count: timers.length,
    totalSeconds: timers.reduce((total, timer) => total + timer.seconds, 0),
    warmups: timers.filter((timer) => timer.kind === "warmup").length,
    cooldowns: timers.filter((timer) => timer.kind === "cooldown").length,
    work: timers.filter((timer) => timer.kind === "work").length,
    rest: timers.filter((timer) => timer.kind === "rest").length,
    workSeconds: uniqueSeconds(timers, "work"),
    restSeconds: uniqueSeconds(timers, "rest"),
    middleOrder: middle.map((timer) => timer.kind),
    middleOrderStartsWith: middle[0]?.kind || null,
  };
}

function uniqueSeconds(timers, kind) {
  return [...new Set(timers.filter((timer) => timer.kind === kind).map((timer) => timer.seconds))];
}

function assertExpectation(actual, expected, label) {
  for (const [key, expectedValue] of Object.entries(expected || {})) {
    assert.deepEqual(actual[key], expectedValue, `${label}: ${key}`);
  }
}
