#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultState, formatConversationForCopy, submitAssistantText } from "../assistant-session.js";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultFixturePath = resolve(rootDir, "tests/assistant-dialog-fixtures.json");

const args = parseArgs(process.argv.slice(2));
const fixtures = JSON.parse(await readFile(args.fixtures, "utf8"));
const selectedFixtures = args.fixture
  ? fixtures.filter((fixture) => fixture.name === args.fixture)
  : fixtures;

if (args.list) {
  for (const fixture of fixtures) {
    console.log(`${fixture.name}: ${fixture.description}`);
  }
  process.exit(0);
}

if (!selectedFixtures.length) {
  console.error(`No fixture found for "${args.fixture}".`);
  process.exit(1);
}

let failures = 0;

for (const fixture of selectedFixtures) {
  const state = defaultState();
  if (!args.quiet) console.log(`\n# ${fixture.name}`);

  for (const [turnIndex, turn] of fixture.turns.entries()) {
    const result = await submitAssistantText({
      state,
      text: turn.user,
      useTinyLlm: args.tiny,
      onStatus: args.verbose ? (status) => console.error(`[status] ${status}`) : undefined,
    });

    const actual = summarizeTimers(state.timers);
    const errors = compareExpectation(actual, turn.expect);

    if (!args.quiet) {
      console.log(`\nUser: ${turn.user}`);
      console.log(`Timmy (${result.plan?.source || "error"}): ${result.reply}`);
      console.log(`Summary: ${JSON.stringify(actual)}`);
    }

    if (errors.length) {
      failures += 1;
      console.error(`\nFixture "${fixture.name}" turn ${turnIndex + 1} failed:`);
      for (const error of errors) console.error(`- ${error}`);
      console.error("\nCopied log:");
      console.error(formatConversationForCopy(state));
      if (args.failFast) process.exit(1);
    }
  }

  if (args.showLog && !args.quiet) {
    console.log("\nCopied log:");
    console.log(formatConversationForCopy(state));
  }
}

if (failures) {
  console.error(`\n${failures} fixture turn(s) failed.`);
  process.exit(1);
}

if (!args.quiet) {
  console.log(`\n${selectedFixtures.length} fixture(s) passed.`);
}

function parseArgs(argv) {
  const parsed = {
    failFast: true,
    fixture: null,
    fixtures: defaultFixturePath,
    list: false,
    quiet: false,
    showLog: false,
    tiny: false,
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--fixture") parsed.fixture = argv[++index];
    else if (arg === "--fixtures") parsed.fixtures = resolve(process.cwd(), argv[++index]);
    else if (arg === "--list") parsed.list = true;
    else if (arg === "--no-fail-fast") parsed.failFast = false;
    else if (arg === "--quiet") parsed.quiet = true;
    else if (arg === "--show-log") parsed.showLog = true;
    else if (arg === "--tiny") parsed.tiny = true;
    else if (arg === "--verbose") parsed.verbose = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/timmy-harness.mjs [options]

Options:
  --fixture <name>       Run one fixture by name
  --fixtures <path>      Use a custom fixture JSON file
  --list                 List available fixtures
  --show-log             Print copied Timmy log after each fixture
  --tiny                 Request Tiny LLM path if the runtime supports it
  --quiet                Only print failures
  --no-fail-fast         Continue after failures
  --verbose              Print planner status callbacks`);
}

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

function compareExpectation(actual, expected = {}) {
  const errors = [];
  for (const [key, expectedValue] of Object.entries(expected)) {
    const actualValue = actual[key];
    if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
      errors.push(`${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`);
    }
  }
  return errors;
}
