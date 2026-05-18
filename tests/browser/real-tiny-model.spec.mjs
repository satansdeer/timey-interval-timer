import { chromium, expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TRAINED_TINY_MODEL_ID, TRANSFORMERS_PACKAGE_VERSION } from "../../llm-planner.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const shouldRunRealTinyModel = process.env.TIMEY_REAL_TINY_MODEL === "1";
const browserChannel = process.env.TIMEY_REAL_TINY_MODEL_CHANNEL || "chrome";
const profileDir =
  process.env.TIMEY_REAL_TINY_MODEL_PROFILE_DIR ||
  join(tmpdir(), `timey-real-tiny-model-profile-${browserChannel.replaceAll(/\W+/g, "-")}`);
const timeoutMs = Number(process.env.TIMEY_REAL_TINY_MODEL_TIMEOUT_MS || 15 * 60_000);

const defaultTimers = [
  { label: "Warmup", seconds: 300, kind: "warmup" },
  { label: "High intensity", seconds: 60, kind: "work" },
  { label: "Rest", seconds: 60, kind: "rest" },
  { label: "Cooldown", seconds: 300, kind: "cooldown" },
];

const problemScenarios = [
  {
    name: "alternations with warmup and cooldown",
    category: "core-regression",
    text: "I want 8 minutes warmup, then 4 alterations of high intensity and low intensity and then 8 minutes cooldown",
    expectedTimers: withEndpoints(480, 480, alternating(4, ["work", "rest"], 60)),
  },
  {
    name: "six alternating one-minute middle intervals",
    category: "core-regression",
    text: "8 minutes warmup, 6 alterating 1 minute rest / work. then 8 minutes cooldown",
    expectedTimers: withEndpoints(480, 480, alternating(6, ["rest", "work"], 60)),
  },
  {
    name: "four one-minute work-rest middle intervals",
    category: "core-regression",
    text: "8 minute warmup, 8 minutes cooldown. 4 one minute intervals work/rest in the middle (1 minute each)",
    expectedTimers: withEndpoints(480, 480, alternating(4, ["work", "rest"], 60)),
  },
  {
    name: "four one-minute alterations in the middle",
    category: "core-regression",
    text: "8 minutes warmup, 8 minutes cooldown, 4 of 1 minute alterations work/rest in the middle",
    expectedTimers: withEndpoints(480, 480, alternating(4, ["work", "rest"], 60)),
  },
  {
    name: "four rest-work steps between warmup and cooldown",
    category: "core-regression",
    text: "8 minute warmup, 4 steps of 1 minute rest 1 minute work, then 8 minute cooldown",
    expectedTimers: withEndpoints(480, 480, pairs(4, ["rest", "work"], 60, 60)),
  },
  {
    name: "five rest-work intervals with longer endpoints",
    category: "core-regression",
    text: "Please make warmup 12 minutes, cooldown 9 minutes, and exactly 5 intervals in the middle, each 45 seconds, alternating rest then work",
    expectedTimers: withEndpoints(720, 540, alternating(5, ["rest", "work"], 45)),
  },
  {
    name: "eight typo rest-work steps between endpoints",
    category: "core-regression",
    text: "Warmup 8 minu, 8 minutes cooldown. Between 8 steps each 1 minute alterating rest/work",
    expectedTimers: withEndpoints(480, 480, alternating(8, ["rest", "work"], 60)),
  },
  genericScenario("standalone timer list does not copy default workout", "5 one minute timers and one 30 second", [
    [5, 60],
    [1, 30],
  ]),
  genericScenario("ten one-minute generic timers", "10 one minute timers", [[10, 60]]),
  genericScenario("word ten one-minute generic timers", "ten 1 minute timers", [[10, 60]]),
  genericScenario("three one-minute generic timers", "3 one minute timers", [[3, 60]]),
  genericScenario("four forty-five-second intervals", "four 45 second intervals", [[4, 45]]),
  genericScenario("mixed two-minute and thirty-second timers", "2 two minute timers and 3 thirty second timers", [
    [2, 120],
    [3, 30],
  ]),
  genericScenario("timers each duration", "six timers, each 20 seconds", [[6, 20]]),
  genericScenario("timers for duration groups", "Make 1 timer for 90 seconds and 4 timers for 15 seconds", [
    [1, 90],
    [4, 15],
  ]),
  genericScenario("ten ten-second intervals", "I just need ten 10 second intervals", [[10, 10]]),
  genericScenario("three single generic groups", "one 5 minute timer, one 1 minute timer, one 30 second timer", [
    [1, 300],
    [1, 60],
    [1, 30],
  ]),
  genericScenario("timers of duration", "7 timers of 40 seconds", [[7, 40]]),
  genericScenario("standalone timers duration each", "Create exactly 12 standalone timers, 45 seconds each", [[12, 45]]),
  genericScenario("then-separated generic groups", "2 thirty second timers then 3 ten second timers", [
    [2, 30],
    [3, 10],
  ]),
  genericScenario("separate timers of duration", "Make 5 separate timers of 2 minutes", [[5, 120]]),
  genericScenario("comma separated generic timer groups", "8 minute timer, 4 one minute timers, 8 minute timer", [
    [1, 480],
    [4, 60],
    [1, 480],
  ]),
  genericScenario("positional compact minute spelling", "first and last timer 5minute, 5 one minute timers in between", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("positional original collapsed prompt", "first and last timers 5 minute, 5 one minute in between", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("first-last are with middle timers", "first and last are 5 minutes, with five 1 minute timers in between", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("start-end with middle timers", "start and end with 5 minute timers, 5 one-minute timers in the middle", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("bookend wording", "bookend the workout with 5 minute timers and put 5 one minute timers between them", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("explicit first and final timers", "make the first timer 5 minutes and the final timer 5 minutes, with five 1 minute timers between", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("outer-inside wording", "outer timers 5 minutes, inside 5 one minute timers", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("between two outer timers", "put five one minute timers between two 5 minute timers", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("two outer timers with middle", "two 5 minute timers with 5 one minute timers in between", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("duration before first-last wording", "2 minute first and last timers, 8 thirty second timers between", [
    [1, 120],
    [8, 30],
    [1, 120],
  ]),
  genericScenario("first-final ninety-second bookends", "first and final timers should be 90 seconds, put 4 twenty second timers between them", [
    [1, 90],
    [4, 20],
    [1, 90],
  ]),
  genericScenario("begin-finish wording", "begin and finish with 3 minute timers, with 6 45 second timers in between", [
    [1, 180],
    [6, 45],
    [1, 180],
  ]),
  genericScenario("outside timers with middle wording", "outside timers are 4 minutes each, middle is 7 one minute timers", [
    [1, 240],
    [7, 60],
    [1, 240],
  ]),
  genericScenario("first-last repeated endpoint wording", "first timer 30 seconds, last timer 30 seconds, and three 10 second timers in between", [
    [1, 30],
    [3, 10],
    [1, 30],
  ]),
  genericScenario("start-end repeated endpoint wording", "start with 45 seconds, end with 45 seconds, put 5 fifteen second timers between", [
    [1, 45],
    [5, 15],
    [1, 45],
  ]),
  genericScenario("start-middle-end generic wording", "one 6 minute timer at the start, four 30 second timers in the middle, one 6 minute timer at the end", [
    [1, 360],
    [4, 30],
    [1, 360],
  ]),
  genericScenario("first-last two-minute with ten middle", "make the first and last timers 2 minutes, and add 10 twenty second timers between them", [
    [1, 120],
    [10, 20],
    [1, 120],
  ]),
  genericScenario("short first-last bookends", "10 second first and last timers with 8 five second timers in between", [
    [1, 10],
    [8, 5],
    [1, 10],
  ]),
  genericScenario("first-then-last wording", "first is 1 minute, then five 20 second timers, last is 1 minute", [
    [1, 60],
    [5, 20],
    [1, 60],
  ]),
  genericScenario("first-last four-minute bookends", "first 4 minutes, last 4 minutes, six 30 second timers in the middle", [
    [1, 240],
    [6, 30],
    [1, 240],
  ]),
  genericScenario("another timer wording", "make a 2 minute timer, then 5 one minute timers, then another 2 minute timer", [
    [1, 120],
    [5, 60],
    [1, 120],
  ]),
  genericScenario("beginning-end wording", "3 minutes at the beginning and end, with four 45 second timers inside", [
    [1, 180],
    [4, 45],
    [1, 180],
  ]),
  genericScenario("begin-finish same duration wording", "begin with 5 minutes, add 5 one minute timers, finish with 5 minutes", [
    [1, 300],
    [5, 60],
    [1, 300],
  ]),
  genericScenario("validation first-last four-minute bookends", "first and last timers are 4 minutes, put five 30 second timers in between", [
    [1, 240],
    [5, 30],
    [1, 240],
  ]),
  genericScenario("validation outer ninety-second bookends", "outer timers 90 seconds, inside 6 ten second timers", [
    [1, 90],
    [6, 10],
    [1, 90],
  ]),
  genericScenario("around wording", "two 3 minute timers around 8 one minute timers", [
    [1, 180],
    [8, 60],
    [1, 180],
  ]),
  explicitScenario("explicit label copy", "30 seconds: Plank, 45 seconds: Squats, 1 minute: Rest", [
    ["Plank", 30, "other"],
    ["Squats", 45, "other"],
    ["Rest", 60, "rest"],
  ]),
  explicitScenario("explicit warmup work rest cooldown", "5 min: Warmup, 1 min: Work, 30 sec: Rest, 5 min: Cooldown", [
    ["Warmup", 300, "warmup"],
    ["Work", 60, "work"],
    ["Rest", 30, "rest"],
    ["Cooldown", 300, "cooldown"],
  ]),
  explicitScenario("explicit semicolon sequence", "20 seconds: Jumping jacks; 10 seconds: Rest; 20 seconds: Pushups; 10 seconds: Rest", [
    ["Jumping jacks", 20, "other"],
    ["Rest", 10, "rest"],
    ["Pushups", 20, "other"],
    ["Rest", 10, "rest"],
  ]),
  explicitScenario("explicit spin sequence", "2 minutes: Easy spin, 30 seconds: Hard effort, 30 seconds: Recovery, 2 minutes: Warmdown", [
    ["Easy spin", 120, "rest"],
    ["Hard effort", 30, "work"],
    ["Recovery", 30, "rest"],
    ["Warmdown", 120, "cooldown"],
  ]),
];

test.skip(
  !shouldRunRealTinyModel,
  "Set TIMEY_REAL_TINY_MODEL=1 to run the real tiny browser model test.",
);

test("trained tiny timer model obeys interval setup prompts", async () => {
  test.setTimeout(timeoutMs);

  const server = await startRepoServer();
  const context = await chromium.launchPersistentContext(profileDir, {
    args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
    ...(browserChannel === "bundled" ? {} : { channel: browserChannel }),
    headless: process.env.TIMEY_REAL_TINY_MODEL_HEADED !== "1",
    serviceWorkers: "block",
    viewport: { width: 1280, height: 720 },
  });

  try {
    const page = await context.newPage();
    await page.goto(`${server.origin}/__real_tiny_model_test.html`);

    const result = await page.evaluate(
      async ({ defaultTimers: currentTimers, scenarios }) => {
        const statuses = [];

        try {
          const llm = await import("/llm-planner.js");
          const selectedModel = await llm.preloadTinyLlm((text, progress) => {
            statuses.push({ phase: "preload", text, progress });
          });
          const outputs = [];

          for (const scenario of scenarios) {
            const planned = await llm.planWithTinyLlm({
              text: scenario.text,
              currentTimers,
              currentWorkoutShape: {
                intervalCount: 4,
                totalSeconds: 720,
              },
              conversation: [
                {
                  role: "assistant",
                  text: "Tell me your warmup, intervals, rests, and cooldown. I will schedule the workout.",
                },
              ],
              onStatus: (text, progress) => {
                statuses.push({ phase: scenario.name, text, progress });
              },
            });

            outputs.push({
              name: scenario.name,
              model: planned.model,
              rawContent: planned.rawContent,
              timers: planned.timers,
            });
          }

          return {
            ok: true,
            selectedModel,
            outputs,
            statuses: statuses.slice(-40),
          };
        } catch (error) {
          return {
            ok: false,
            error: String(error?.message || error),
            stack: error?.stack,
            statuses: statuses.slice(-40),
          };
        }
      },
      { defaultTimers, scenarios: problemScenarios },
    );

    expect(result.ok, formatFailure(result)).toBe(true);
    expect(result.selectedModel).toBe(TRAINED_TINY_MODEL_ID);

    const mismatches = [];
    for (const scenario of problemScenarios) {
      const output = result.outputs.find((entry) => entry.name === scenario.name);
      const actual = simplifyTimers(output?.timers);
      const expected = simplifyTimers(scenario.expectedTimers);

      if (output?.model !== TRAINED_TINY_MODEL_ID || JSON.stringify(actual) !== JSON.stringify(expected)) {
        mismatches.push({
          name: scenario.name,
          category: scenario.category,
          prompt: scenario.text,
          model: output?.model,
          expected,
          actual,
          rawContent: output?.rawContent,
          rawTimers: output?.timers,
        });
      }
    }
    console.log(formatCategorySummary(problemScenarios, result.outputs));

    expect(mismatches, formatScenarioFailures(result, mismatches)).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});

function timer(label, seconds, kind) {
  return { label, seconds, kind };
}

function genericScenario(name, text, groups) {
  return { name, category: genericScenarioCategory(name), text, expectedTimers: genericGroups(groups) };
}

function explicitScenario(name, text, entries) {
  return {
    name,
    category: "explicit-label-copy",
    text,
    expectedTimers: entries.map(([label, seconds, kind]) => timer(label, seconds, kind)),
  };
}

function genericScenarioCategory(name) {
  return /\b(positional|first|last|final|start|end|bookend|outer|outside|between|middle|begin|finish|another|around|beginning)\b/i.test(
    name,
  )
    ? "generic-position"
    : "generic-count";
}

function genericGroups(groups) {
  const timers = [];
  for (const [count, seconds] of groups) {
    for (let index = 0; index < count; index += 1) {
      timers.push(timer(`Timer ${timers.length + 1}`, seconds, "other"));
    }
  }
  return timers;
}

function withEndpoints(warmupSeconds, cooldownSeconds, middleTimers) {
  return [
    timer("Warmup", warmupSeconds, "warmup"),
    ...middleTimers,
    timer("Cooldown", cooldownSeconds, "cooldown"),
  ];
}

function alternating(count, order, seconds) {
  const labels = { work: "Work", rest: "Rest" };
  return Array.from({ length: count }, (_, index) => {
    const kind = order[index % order.length];
    return timer(labels[kind], seconds, kind);
  });
}

function pairs(count, order, workSeconds, restSeconds) {
  const timers = [];
  const labels = { work: "Work", rest: "Rest" };
  for (let cycle = 0; cycle < count; cycle += 1) {
    for (const kind of order) {
      timers.push(timer(labels[kind], kind === "work" ? workSeconds : restSeconds, kind));
    }
  }
  return timers;
}

function simplifyTimers(timers = []) {
  return timers.map(({ seconds, kind }) => ({ seconds, kind }));
}

function formatCategorySummary(scenarios, outputs) {
  const buckets = new Map();
  for (const scenario of scenarios) {
    const category = scenario.category || "uncategorized";
    const output = outputs.find((entry) => entry.name === scenario.name);
    const actual = simplifyTimers(output?.timers);
    const expected = simplifyTimers(scenario.expectedTimers);
    const passed = output?.model === TRAINED_TINY_MODEL_ID && JSON.stringify(actual) === JSON.stringify(expected);
    const bucket = buckets.get(category) ?? { count: 0, passed: 0 };
    bucket.count += 1;
    if (passed) bucket.passed += 1;
    buckets.set(category, bucket);
  }

  return [
    "Real tiny model by category:",
    ...[...buckets.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, bucket]) => {
        const percent = bucket.count ? ((bucket.passed / bucket.count) * 100).toFixed(1) : "0.0";
        return `  ${category}: ${bucket.passed}/${bucket.count} (${percent}%)`;
      }),
  ].join("\n");
}

function formatFailure(result) {
  return [
    `Real tiny model test failed for ${TRAINED_TINY_MODEL_ID} via @huggingface/transformers@${TRANSFORMERS_PACKAGE_VERSION}.`,
    result.error ? `error: ${result.error}` : null,
    result.stack ? `stack: ${result.stack}` : null,
    result.statuses?.length ? `recent status: ${JSON.stringify(result.statuses, null, 2)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatScenarioFailures(result, mismatches) {
  return [
    `Real tiny model output did not match expected timers for ${mismatches.length} scenario(s).`,
    `model: ${result.selectedModel}`,
    `mismatches: ${JSON.stringify(mismatches, null, 2)}`,
    result.statuses?.length ? `recent status: ${JSON.stringify(result.statuses, null, 2)}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

async function startRepoServer() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === "/" || pathname === "/__real_tiny_model_test.html") {
        response.writeHead(200, responseHeaders("text/html; charset=utf-8"));
        response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Timey real tiny model test</title>
  </head>
  <body></body>
</html>
`);
        return;
      }

      const filePath = resolve(repoRoot, pathname.slice(1));
      if (filePath !== repoRoot && !filePath.startsWith(`${repoRoot}${sep}`)) {
        throw new Error("Path escapes repo root");
      }

      const body = await readFile(filePath);
      response.writeHead(200, responseHeaders(contentType(filePath)));
      response.end(body);
    } catch {
      response.writeHead(404, responseHeaders("text/plain; charset=utf-8"));
      response.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function responseHeaders(contentTypeValue) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentTypeValue,
    "Cross-Origin-Embedder-Policy": "credentialless",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

function contentType(filePath) {
  const extension = extname(basename(filePath));
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webmanifest") return "application/manifest+json";
  return "application/octet-stream";
}
