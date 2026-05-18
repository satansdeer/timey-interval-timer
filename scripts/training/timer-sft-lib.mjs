import {
  MAX_INTERVALS as TIMER_DSL_MAX_INTERVALS,
  TIMER_DSL_END_TOKEN,
  areSameTimerDslTimers as areSameTimer,
  formatCompactDuration,
  formatRepeatCommand,
  formatTimerCommand,
  isNumberedGenericTimerLabel,
  normalizeTimerDslTimer as normalizeComparableTimer,
  parseTimerDsl,
  validateTimerDslTimer as validateTimer,
} from "../../timer-dsl.js";

export const DATASET_VERSION = "2026-05-17";
export const DEFAULT_USER_FORMAT = "app";
export const DEFAULT_TARGET_FORMAT = "json";
export const DSL_END_TOKEN = TIMER_DSL_END_TOKEN;
export const MAX_INTERVALS = TIMER_DSL_MAX_INTERVALS;
export { formatCompactDuration, parseTimerDsl };

export const JSON_SYSTEM_PROMPT = [
  "You convert natural-language workout timer requests into strict JSON for Timey.",
  'Return only JSON shaped as {"timers":[{"label":"Warmup","durationSeconds":480,"kind":"warmup"}]}.',
  "Allowed kind values are warmup, work, rest, cooldown, and other.",
  "durationSeconds must be elapsed seconds, not minutes or counts.",
  "Warmup and cooldown are separate timers when requested.",
  "Intervals, steps, timers, alterations, and alternations are individual middle timers unless the request says each block, round, cycle, set, or step contains both rest and work.",
  "Blocks, rounds, cycles, and sets of rest/work are repeated pairs.",
  "Use only the request and supplied correction context. Do not copy defaults.",
].join(" ");
export const DSL_SYSTEM_PROMPT = [
  "You convert natural-language workout timer requests into Timey timer lines.",
  "Return only Timey timer commands.",
  "Use compact elapsed time: 8m, 45s, 1m30s, or 1h5m.",
  "A single timer is duration: label.",
  "Use Nx duration: label to repeat the same timer N times.",
  "Use Nx duration: label | duration: label to repeat a full block N times.",
  "Use Nalt duration: label | duration: label for N total alternating timers.",
  "Example output: 8m: Warmup\\n5alt 45s: Rest | 45s: Work\\n9m: Cooldown.",
  "Warmup and cooldown are separate lines when requested.",
  "Intervals, steps, timers, alterations, and alternations are individual middle timers unless the request says each block, round, cycle, set, or step contains both rest and work.",
  "Blocks, rounds, cycles, and sets of rest/work are repeated pairs.",
  "Use Timer as the label for repeated generic timers; do not number generic timer labels.",
  "Use only the request and supplied correction context. Do not copy defaults.",
].join(" ");
export const SYSTEM_PROMPT = JSON_SYSTEM_PROMPT;
export const QWEN3_NO_THINK_SYSTEM_PROMPT = `${SYSTEM_PROMPT} /no_think`;
export const QWEN3_DSL_NO_THINK_SYSTEM_PROMPT = `${DSL_SYSTEM_PROMPT} /no_think`;

const TIMER_DSL_HINTS = new WeakMap();
const WORD_NUMBERS = {
  1: "one",
  2: "two",
  3: "three",
  4: "four",
  5: "five",
  6: "six",
  7: "seven",
  8: "eight",
  9: "nine",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
};

export function buildTimerSftExamples({
  dslEndToken = false,
  targetFormat = DEFAULT_TARGET_FORMAT,
  userFormat = DEFAULT_USER_FORMAT,
  systemPrompt = null,
} = {}) {
  assertTargetFormat(targetFormat);
  assertUserFormat(userFormat);

  const records = [];
  const seen = new Set();
  const baseSystemPrompt = systemPrompt ?? (targetFormat === "dsl" ? DSL_SYSTEM_PROMPT : JSON_SYSTEM_PROMPT);
  const resolvedSystemPrompt =
    targetFormat === "dsl" && dslEndToken
      ? `${baseSystemPrompt} Finish with ${DSL_END_TOKEN} on its own final line.`
      : baseSystemPrompt;

  for (const spec of buildSpecs()) {
    if (userFormat === "natural" && spec.correctionRequest) continue;

    const assistantContent =
      targetFormat === "dsl"
        ? formatTimerDsl(spec.timers, { endToken: dslEndToken })
        : JSON.stringify({ timers: spec.timers });
    const userContent =
      userFormat === "natural"
        ? spec.request
        : JSON.stringify(spec.payload ?? { correctionRequest: false, userRequest: spec.request });
    const duplicateKey = `${userContent}\n${assistantContent}`;
    if (seen.has(duplicateKey)) continue;
    seen.add(duplicateKey);

    const id = `timer-sft-${String(records.length + 1).padStart(4, "0")}`;
    const record = {
      id,
      datasetVersion: DATASET_VERSION,
      category: spec.category,
      split: spec.split ?? null,
      targetFormat,
      userFormat,
      dslEndToken: targetFormat === "dsl" ? Boolean(dslEndToken) : false,
      messages: [
        { role: "system", content: resolvedSystemPrompt },
        { role: "user", content: userContent },
        { role: "assistant", content: assistantContent },
      ],
      metadata: {
        userRequest: spec.request,
        expectedTimers: spec.timers,
      },
    };

    validateDatasetRecord(record);
    records.push(record);
  }

  return records;
}

export function splitTimerSftExamples(records, { validationRatio = 0.18 } = {}) {
  const train = [];
  const validation = [];
  const flexibleByCategory = new Map();

  for (const record of records) {
    if (record.split === "train") {
      train.push(withoutSplit(record));
    } else if (record.split === "validation") {
      validation.push(withoutSplit(record));
    } else {
      const group = flexibleByCategory.get(record.category) ?? [];
      group.push(record);
      flexibleByCategory.set(record.category, group);
    }
  }

  for (const group of flexibleByCategory.values()) {
    const sorted = [...group].sort((left, right) => stableHash(left.id) - stableHash(right.id));
    const validationCount = Math.max(1, Math.round(sorted.length * validationRatio));

    for (let index = 0; index < sorted.length; index += 1) {
      const target = index < validationCount ? validation : train;
      target.push(withoutSplit(sorted[index]));
    }
  }

  return {
    train: train.sort(compareIds),
    validation: validation.sort(compareIds),
  };
}

export function summarizeRecords(records) {
  const categories = {};
  for (const record of records) {
    categories[record.category] = (categories[record.category] ?? 0) + 1;
  }
  return {
    count: records.length,
    categories,
  };
}

export function validateDatasetRecord(record) {
  if (!record || typeof record !== "object") {
    throw new Error("Record must be an object");
  }
  if (!record.id || typeof record.id !== "string") {
    throw new Error("Record is missing id");
  }
  if (!record.category || typeof record.category !== "string") {
    throw new Error(`${record.id}: category must be a string`);
  }
  if (!Array.isArray(record.messages) || record.messages.length !== 3) {
    throw new Error(`${record.id}: messages must contain system, user, and assistant turns`);
  }
  const [system, user, assistant] = record.messages;
  if (system.role !== "system" || user.role !== "user" || assistant.role !== "assistant") {
    throw new Error(`${record.id}: message roles must be system, user, assistant`);
  }
  const targetFormat = record.targetFormat ?? "json";
  if (!["json", "dsl"].includes(targetFormat)) {
    throw new Error(`${record.id}: invalid targetFormat ${JSON.stringify(targetFormat)}`);
  }
  if (
    typeof system.content !== "string" ||
    (targetFormat === "json" && !system.content.includes("Return only JSON")) ||
    (targetFormat === "dsl" && !system.content.includes("duration: label"))
  ) {
    throw new Error(`${record.id}: system prompt is missing target format instruction`);
  }
  if (typeof user.content !== "string" || !user.content.trim()) {
    throw new Error(`${record.id}: user content must be a non-empty string`);
  }
  if (record.userFormat === "app") {
    const payload = parseJsonObject(user.content, `${record.id}: user payload`);
    if (payload.schema) throw new Error(`${record.id}: user payload must not include schema`);
    if (typeof payload.userRequest !== "string" || !payload.userRequest.trim()) {
      throw new Error(`${record.id}: user payload must include userRequest`);
    }
    if (typeof payload.correctionRequest !== "boolean") {
      throw new Error(`${record.id}: user payload must include correctionRequest boolean`);
    }
  }

  const parsed =
    targetFormat === "dsl"
      ? parseTimerDsl(assistant.content, `${record.id}: assistant content`)
      : parseTimerJson(assistant.content, `${record.id}: assistant content`);
  if (record.metadata?.expectedTimers) {
    const errors = compareTimerOutputs(record.metadata.expectedTimers, parsed.timers, {
      ignoreLabels: false,
    });
    if (errors.length) {
      throw new Error(`${record.id}: assistant content does not match metadata: ${errors.join("; ")}`);
    }
  }

  return true;
}

export function parseTimerJson(content, context = "timer JSON") {
  const parsed = parseJsonObject(content, context);
  const keys = Object.keys(parsed);
  if (keys.length !== 1 || keys[0] !== "timers") {
    throw new Error(`${context}: expected only a timers property`);
  }
  if (!Array.isArray(parsed.timers) || parsed.timers.length < 1 || parsed.timers.length > MAX_INTERVALS) {
    throw new Error(`${context}: timers must be a non-empty array with at most ${MAX_INTERVALS} entries`);
  }
  return {
    timers: parsed.timers.map((timer, index) => validateTimer(timer, `${context}: timer ${index + 1}`)),
  };
}

export function formatTimerDsl(timers, { endToken = false } = {}) {
  const content = formatCompressedTimerDsl(timers);
  return endToken ? `${content}\n${DSL_END_TOKEN}` : content;
}

function formatCompressedTimerDsl(timers) {
  const hint = TIMER_DSL_HINTS.get(timers);
  if (hint?.type === "withEndpoints") {
    const lines = [
      formatTimerCommand(timers[0]),
      ...formatDslHintLines(hint.middleHint),
      formatTimerCommand(timers[timers.length - 1]),
    ];
    return lines.join("\n");
  }
  if (hint) return formatDslHintLines(hint).join("\n");
  return compressTimerRuns(timers).join("\n");
}

function formatDslHintLines(hint) {
  if (!hint) return [];
  if (hint.type === "alt") {
    return [`${hint.count}alt ${hint.atoms.map(formatTimerCommand).join(" | ")}`];
  }
  if (hint.type === "block") {
    return [`${hint.count}x ${hint.atoms.map(formatTimerCommand).join(" | ")}`];
  }
  if (hint.type === "generic") {
    return hint.groups.map(([count, seconds]) => formatRepeatCommand(count, timer("Timer", seconds, "other")));
  }
  return [];
}

function compressTimerRuns(timers) {
  const lines = [];
  for (let index = 0; index < timers.length; ) {
    const current = normalizeComparableTimer(timers[index]);
    if (isNumberedGenericTimerLabel(current.label)) {
      const start = index;
      let end = index + 1;
      while (
        end < timers.length &&
        isNumberedGenericTimerLabel(timers[end].label) &&
        timers[end].durationSeconds === current.durationSeconds &&
        timers[end].kind === current.kind
      ) {
        end += 1;
      }
      lines.push(formatRepeatCommand(end - start, timer("Timer", current.durationSeconds, current.kind)));
      index = end;
      continue;
    }

    let count = 1;
    while (index + count < timers.length && areSameTimer(current, timers[index + count])) {
      count += 1;
    }
    lines.push(formatRepeatCommand(count, current));
    index += count;
  }
  return lines;
}

export function compareTimerOutputs(expectedTimers, actualTimers, { ignoreLabels = false } = {}) {
  const errors = [];
  if (!Array.isArray(actualTimers)) {
    return ["actual timers is not an array"];
  }
  if (expectedTimers.length !== actualTimers.length) {
    errors.push(`timer count expected ${expectedTimers.length}, got ${actualTimers.length}`);
  }

  const count = Math.min(expectedTimers.length, actualTimers.length);
  for (let index = 0; index < count; index += 1) {
    const expected = normalizeComparableTimer(expectedTimers[index]);
    const actual = normalizeComparableTimer(actualTimers[index]);
    if (!ignoreLabels && expected.label !== actual.label) {
      errors.push(`timer ${index + 1} label expected ${JSON.stringify(expected.label)}, got ${JSON.stringify(actual.label)}`);
    }
    if (expected.durationSeconds !== actual.durationSeconds) {
      errors.push(`timer ${index + 1} duration expected ${expected.durationSeconds}, got ${actual.durationSeconds}`);
    }
    if (expected.kind !== actual.kind) {
      errors.push(`timer ${index + 1} kind expected ${expected.kind}, got ${actual.kind}`);
    }
  }
  return errors;
}

export function readAssistantTarget(record) {
  const assistant = record.messages.find((message) => message.role === "assistant");
  return (record.targetFormat ?? "json") === "dsl"
    ? parseTimerDsl(assistant.content, `${record.id}: assistant target`).timers
    : parseTimerJson(assistant.content, `${record.id}: assistant target`).timers;
}

function buildSpecs() {
  const specs = [];
  const add = (category, request, timers, options = {}) => {
    specs.push({ category, request, timers, ...options });
  };

  addCoreRegressionSpecs(add);
  addIndividualMiddleSpecs(add);
  addPairSpecs(add);
  addGenericTimerSpecs(add);
  addPositionalGenericTimerSpecs(add);
  addExplicitSequenceSpecs(add);
  addCorrectionSpecs(add);
  addCountStressSpecs(add);
  addExplicitLabelCopyStressSpecs(add);
  addExplicitLabelCopyTrainOnlySpecs(add);

  return specs;
}

function addCoreRegressionSpecs(add) {
  add(
    "core-regression",
    "I want 8 minutes warmup, then 4 alterations of high intensity and low intensity and then 8 minutes cooldown",
    withEndpoints(8, 8, alternating(4, ["work", "rest"], 60, highLowLabels())),
    { split: "train" },
  );
  add(
    "core-regression",
    "8 minutes warmup, 6 alterating 1 minute rest / work. then 8 minutes cooldown",
    withEndpoints(8, 8, alternating(6, ["rest", "work"], 60, workRestLabels())),
    { split: "train" },
  );
  add(
    "core-regression",
    "8 minute warmup, 8 minutes cooldown. 4 one minute intervals work/rest in the middle (1 minute each)",
    withEndpoints(8, 8, alternating(4, ["work", "rest"], 60, workRestLabels())),
    { split: "train" },
  );
  add(
    "core-regression",
    "8 minutes warmup, 8 minutes cooldown, 4 of 1 minute alterations work/rest in the middle",
    withEndpoints(8, 8, alternating(4, ["work", "rest"], 60, workRestLabels())),
    { split: "train" },
  );
  add(
    "core-regression",
    "8 minute warmup, 4 steps of 1 minute rest 1 minute work, then 8 minute cooldown",
    withEndpoints(8, 8, pairs(4, ["rest", "work"], 60, 60, workRestLabels())),
    { split: "train" },
  );
  add(
    "core-regression",
    "5 one minute timers and one 30 second",
    genericTimers([
      [5, 60],
      [1, 30],
    ]),
    { split: "train" },
  );
  add(
    "core-regression",
    "Please make warmup 12 minutes, cooldown 9 minutes, and exactly 5 intervals in the middle, each 45 seconds, alternating rest then work",
    withEndpoints(12, 9, alternating(5, ["rest", "work"], 45, workRestLabels())),
    { split: "validation" },
  );
  add(
    "core-regression",
    "Warmup 8 minu, 8 minutes cooldown. Between 8 steps each 1 minute alterating rest/work",
    withEndpoints(8, 8, alternating(8, ["rest", "work"], 60, workRestLabels())),
    { split: "validation" },
  );
}

function addIndividualMiddleSpecs(add) {
  const endpoints = [
    [5, 5],
    [8, 8],
    [10, 8],
    [12, 9],
  ];
  const counts = [4, 5, 6, 8, 10];
  const durations = [30, 45, 60];
  const orders = [
    { words: "work/rest", phrase: "work then rest", order: ["work", "rest"] },
    { words: "rest/work", phrase: "rest then work", order: ["rest", "work"] },
  ];

  let variant = 0;
  for (const [warmupMinutes, cooldownMinutes] of endpoints) {
    for (const count of counts) {
      for (const durationSeconds of durations) {
        for (const order of orders) {
          const timers = withEndpoints(
            warmupMinutes,
            cooldownMinutes,
            alternating(count, order.order, durationSeconds, workRestLabels()),
          );
          const duration = durationText(durationSeconds);
          const warmup = minuteText(warmupMinutes, variant);
          const cooldown = minuteText(cooldownMinutes, variant + 1);
          const templates = [
            `Warmup ${warmup}, cooldown ${cooldown}, exactly ${count} intervals in the middle, ${duration} each, alternating ${order.phrase}`,
            `${warmupMinutes} min warmup and ${cooldownMinutes} min cooldown with ${count} steps between them, ${duration} each, alternate ${order.words}`,
            `I need ${warmup} warm up, then ${count} ${duration} timers alternating ${order.words}, then ${cooldown} cool down`,
            `${wordOrNumber(count, variant)} middle alterations, ${duration} each, ${order.words}, with ${warmup} warmup and ${cooldown} cooldown`,
          ];
          add("individual-middle", templates[variant % templates.length], timers);
          variant += 1;
        }
      }
    }
  }

  for (const count of [4, 5, 6, 8]) {
    for (const [warmupMinutes, cooldownMinutes] of [
      [5, 5],
      [8, 8],
      [10, 10],
    ]) {
      add(
        "individual-middle",
        `${warmupMinutes} minutes warmup, then ${count} alterations of high intensity and low intensity, then ${cooldownMinutes} minutes cooldown`,
        withEndpoints(warmupMinutes, cooldownMinutes, alternating(count, ["work", "rest"], 60, highLowLabels())),
      );
      add(
        "individual-middle",
        `${warmupMinutes} minute warmup, ${count} alternations low intensity / high intensity, ${cooldownMinutes} minute cooldown`,
        withEndpoints(warmupMinutes, cooldownMinutes, alternating(count, ["rest", "work"], 60, highLowLabels())),
      );
    }
  }
}

function addPairSpecs(add) {
  const endpoints = [
    [5, 5],
    [8, 8],
    [12, 8],
  ];
  const counts = [3, 4, 6, 8];
  const durations = [30, 60, 90];
  const nouns = ["blocks", "rounds", "cycles", "sets"];

  let variant = 0;
  for (const [warmupMinutes, cooldownMinutes] of endpoints) {
    for (const count of counts) {
      for (const durationSeconds of durations) {
        const noun = nouns[variant % nouns.length];
        const duration = durationText(durationSeconds);
        const templates = [
          `Warmup ${warmupMinutes} min, then ${count} alternating ${noun} of ${duration} rest and ${duration} work, then ${cooldownMinutes} min cooldown`,
          `Give me a ${warmupMinutes} minute warmup and ${cooldownMinutes} minute cooldown with ${count} ${noun} of ${duration} hard then ${duration} rest`,
          `${wordOrNumber(count, variant)} ${noun}: ${duration} work, ${duration} recovery, after ${warmupMinutes} min warmup and before ${cooldownMinutes} min cooldown`,
          `Start with ${warmupMinutes} minutes warm up, do ${count} ${noun} each containing ${duration} easy and ${duration} hard, finish with ${cooldownMinutes} minutes cool down`,
        ];
        const order = variant % 2 === 0 ? ["rest", "work"] : ["work", "rest"];
        const labels = templates[variant % templates.length].includes("hard") ? hardEasyLabels() : workRestLabels();
        add(
          "pairs",
          templates[variant % templates.length],
          withEndpoints(warmupMinutes, cooldownMinutes, pairs(count, order, durationSeconds, durationSeconds, labels)),
        );
        variant += 1;
      }
    }
  }

  for (const count of [3, 4, 6]) {
    for (const durationSeconds of [30, 60]) {
      add(
        "pairs",
        `${count} steps of ${durationText(durationSeconds)} rest ${durationText(durationSeconds)} work, with 8 minute warmup and 8 minute cooldown`,
        withEndpoints(8, 8, pairs(count, ["rest", "work"], durationSeconds, durationSeconds, workRestLabels())),
      );
      add(
        "pairs",
        `8 min warmup, ${count} steps where each step has ${durationText(durationSeconds)} work and ${durationText(durationSeconds)} rest, 8 min cooldown`,
        withEndpoints(8, 8, pairs(count, ["work", "rest"], durationSeconds, durationSeconds, workRestLabels())),
      );
    }
  }
}

function addGenericTimerSpecs(add) {
  const specs = [
    {
      request: "3 one minute timers",
      groups: [[3, 60]],
    },
    {
      request: "four 45 second intervals",
      groups: [[4, 45]],
    },
    {
      request: "2 two minute timers and 3 thirty second timers",
      groups: [
        [2, 120],
        [3, 30],
      ],
    },
    {
      request: "six timers, each 20 seconds",
      groups: [[6, 20]],
    },
    {
      request: "Make 1 timer for 90 seconds and 4 timers for 15 seconds",
      groups: [
        [1, 90],
        [4, 15],
      ],
    },
    {
      request: "I just need ten 10 second intervals",
      groups: [[10, 10]],
    },
    {
      request: "one 5 minute timer, one 1 minute timer, one 30 second timer",
      groups: [
        [1, 300],
        [1, 60],
        [1, 30],
      ],
    },
    {
      request: "7 timers of 40 seconds",
      groups: [[7, 40]],
    },
    {
      request: "8 minute timer, 4 one minute timers, 8 minute timer",
      groups: [
        [1, 480],
        [4, 60],
        [1, 480],
      ],
    },
  ];

  for (const spec of specs) {
    add("generic-timers", spec.request, genericTimers(spec.groups));
  }
}

function addPositionalGenericTimerSpecs(add) {
  const trainSpecs = [
    {
      request: "first and last timers 5 minute, 5 one minute in between",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "first and last timer 5minute, 5 one minute timers in between",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "first and last are 5 minutes, with five 1 minute timers in between",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "start and end with 5 minute timers, 5 one-minute timers in the middle",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "bookend the workout with 5 minute timers and put 5 one minute timers between them",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "make the first timer 5 minutes and the final timer 5 minutes, with five 1 minute timers between",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "outer timers 5 minutes, inside 5 one minute timers",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "put five one minute timers between two 5 minute timers",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "two 5 minute timers with 5 one minute timers in between",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
    {
      request: "2 minute first and last timers, 8 thirty second timers between",
      groups: [
        [1, 120],
        [8, 30],
        [1, 120],
      ],
    },
    {
      request: "first and final timers should be 90 seconds, put 4 twenty second timers between them",
      groups: [
        [1, 90],
        [4, 20],
        [1, 90],
      ],
    },
    {
      request: "begin and finish with 3 minute timers, with 6 45 second timers in between",
      groups: [
        [1, 180],
        [6, 45],
        [1, 180],
      ],
    },
    {
      request: "outside timers are 4 minutes each, middle is 7 one minute timers",
      groups: [
        [1, 240],
        [7, 60],
        [1, 240],
      ],
    },
    {
      request: "first timer 30 seconds, last timer 30 seconds, and three 10 second timers in between",
      groups: [
        [1, 30],
        [3, 10],
        [1, 30],
      ],
    },
    {
      request: "start with 45 seconds, end with 45 seconds, put 5 fifteen second timers between",
      groups: [
        [1, 45],
        [5, 15],
        [1, 45],
      ],
    },
    {
      request: "one 6 minute timer at the start, four 30 second timers in the middle, one 6 minute timer at the end",
      groups: [
        [1, 360],
        [4, 30],
        [1, 360],
      ],
    },
    {
      request: "make the first and last timers 2 minutes, and add 10 twenty second timers between them",
      groups: [
        [1, 120],
        [10, 20],
        [1, 120],
      ],
    },
    {
      request: "10 second first and last timers with 8 five second timers in between",
      groups: [
        [1, 10],
        [8, 5],
        [1, 10],
      ],
    },
    {
      request: "first is 1 minute, then five 20 second timers, last is 1 minute",
      groups: [
        [1, 60],
        [5, 20],
        [1, 60],
      ],
    },
    {
      request: "first 4 minutes, last 4 minutes, six 30 second timers in the middle",
      groups: [
        [1, 240],
        [6, 30],
        [1, 240],
      ],
    },
    {
      request: "make a 2 minute timer, then 5 one minute timers, then another 2 minute timer",
      groups: [
        [1, 120],
        [5, 60],
        [1, 120],
      ],
    },
    {
      request: "3 minutes at the beginning and end, with four 45 second timers inside",
      groups: [
        [1, 180],
        [4, 45],
        [1, 180],
      ],
    },
    {
      request: "begin with 5 minutes, add 5 one minute timers, finish with 5 minutes",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
    },
  ];
  const validationSpecs = [
    {
      request: "first and last timers are 4 minutes, put five 30 second timers in between",
      groups: [
        [1, 240],
        [5, 30],
        [1, 240],
      ],
    },
    {
      request: "outer timers 90 seconds, inside 6 ten second timers",
      groups: [
        [1, 90],
        [6, 10],
        [1, 90],
      ],
    },
    {
      request: "start and finish with 2 minute timers and put four 45 second timers between them",
      groups: [
        [1, 120],
        [4, 45],
        [1, 120],
      ],
    },
    {
      request: "two 3 minute timers around 8 one minute timers",
      groups: [
        [1, 180],
        [8, 60],
        [1, 180],
      ],
    },
    {
      request: "first timer 20 seconds, final timer 20 seconds, seven 5 second timers in between",
      groups: [
        [1, 20],
        [7, 5],
        [1, 20],
      ],
    },
  ];
  const generatedTrainTemplates = [
    ({ outerDuration, middleCount, middleDuration }) =>
      `first and last timers ${outerDuration}, put ${middleCount} ${middleDuration} timers in between`,
    ({ outerDuration, middleCount, middleDuration }) =>
      `outer timers are ${outerDuration}, inside there are ${middleCount} ${middleDuration} timers`,
    ({ outerDuration, middleCount, middleDuration }) =>
      `start and finish with ${outerDuration} timers and put ${middleCount} ${middleDuration} timers between them`,
    ({ outerDuration, middleCount, middleDuration }) =>
      `two ${outerDuration} timers around ${middleCount} ${middleDuration} timers`,
    ({ outerDuration, middleCount, middleDuration }) =>
      `first timer ${outerDuration}, final timer ${outerDuration}, ${middleCount} ${middleDuration} timers in between`,
    ({ outerDuration, middleCount, middleDuration }) =>
      `begin with ${outerDuration}, then ${middleCount} ${middleDuration} timers, then ${outerDuration} again`,
    ({ outerDuration, middleCount, middleDuration }) =>
      `put ${middleCount} ${middleDuration} timers between a ${outerDuration} first timer and a ${outerDuration} last timer`,
    ({ outerDuration, middleCount, middleDuration }) =>
      `make the end timers ${outerDuration} each and the middle ${middleCount} ${middleDuration} timers`,
  ];
  const generatedOuterDurations = [20, 30, 45, 60, 90, 120, 180, 240, 300];
  const generatedMiddleDurations = [5, 10, 15, 20, 30, 45, 60];
  const generatedMiddleCounts = [3, 4, 5, 6, 7, 8, 10];

  let variant = 0;
  for (const outerSeconds of generatedOuterDurations) {
    for (const middleSeconds of generatedMiddleDurations) {
      const middleCount = generatedMiddleCounts[variant % generatedMiddleCounts.length];
      const template = generatedTrainTemplates[variant % generatedTrainTemplates.length];
      trainSpecs.push({
        request: template({
          outerDuration: durationText(outerSeconds),
          middleCount: wordOrNumber(middleCount, variant),
          middleDuration: durationText(middleSeconds),
        }),
        groups: [
          [1, outerSeconds],
          [middleCount, middleSeconds],
          [1, outerSeconds],
        ],
      });
      variant += 1;
    }
  }

  for (const spec of trainSpecs) {
    add("generic-position", spec.request, genericTimers(spec.groups), { split: "train" });
  }
  for (const spec of validationSpecs) {
    add("generic-position", spec.request, genericTimers(spec.groups), { split: "validation" });
  }
}

function addExplicitSequenceSpecs(add) {
  const sequences = [
    {
      request: "30 seconds: Plank, 45 seconds: Squats, 1 minute: Rest",
      timers: [
        timer("Plank", 30, "other"),
        timer("Squats", 45, "other"),
        timer("Rest", 60, "rest"),
      ],
    },
    {
      request: "5 min: Warmup, 1 min: Work, 30 sec: Rest, 5 min: Cooldown",
      timers: [
        timer("Warmup", 300, "warmup"),
        timer("Work", 60, "work"),
        timer("Rest", 30, "rest"),
        timer("Cooldown", 300, "cooldown"),
      ],
    },
    {
      request: "20 seconds: Jumping jacks; 10 seconds: Rest; 20 seconds: Pushups; 10 seconds: Rest",
      timers: [
        timer("Jumping jacks", 20, "other"),
        timer("Rest", 10, "rest"),
        timer("Pushups", 20, "other"),
        timer("Rest", 10, "rest"),
      ],
    },
    {
      request: "2 minutes: Easy spin, 30 seconds: Hard effort, 30 seconds: Recovery, 2 minutes: Warmdown",
      timers: [
        timer("Easy spin", 120, "rest"),
        timer("Hard effort", 30, "work"),
        timer("Recovery", 30, "rest"),
        timer("Warmdown", 120, "cooldown"),
      ],
    },
    {
      request: "1 min 30 sec: Work, 45 sec: Rest, 1 min 30 sec: Work, 45 sec: Rest",
      timers: [
        timer("Work", 90, "work"),
        timer("Rest", 45, "rest"),
        timer("Work", 90, "work"),
        timer("Rest", 45, "rest"),
      ],
    },
  ];

  for (const sequence of sequences) {
    add("explicit-sequence", sequence.request, sequence.timers);
  }
}

function addCorrectionSpecs(add) {
  const baseEightSteps = withEndpoints(8, 8, alternating(8, ["rest", "work"], 60, workRestLabels()));
  add(
    "correction",
    "ah, too many intervals in between, make it twice as little",
    withEndpoints(8, 8, alternating(4, ["rest", "work"], 60, workRestLabels())),
    {
      correctionRequest: true,
      payload: correctionPayload({
        request: "ah, too many intervals in between, make it twice as little",
        currentTimers: baseEightSteps,
        conversation: [
          {
            role: "user",
            text: "Warmup 8 minu, 8 minutes cooldown. Between 8 steps each 1 minute alterating rest/work",
          },
        ],
      }),
    },
  );

  const baseSixSteps = withEndpoints(8, 8, alternating(6, ["work", "rest"], 60, workRestLabels()));
  add(
    "correction",
    "actually make the middle blocks 30 seconds each",
    withEndpoints(8, 8, alternating(6, ["work", "rest"], 30, workRestLabels())),
    {
      correctionRequest: true,
      payload: correctionPayload({
        request: "actually make the middle blocks 30 seconds each",
        currentTimers: baseSixSteps,
        conversation: [
          {
            role: "user",
            text: "8 minute warmup, 8 minutes cooldown and six steps in the middle one minute each alternating between work and rest",
          },
        ],
      }),
    },
  );

  add(
    "correction",
    "not rest first, start the middle with work",
    withEndpoints(8, 8, alternating(8, ["work", "rest"], 60, workRestLabels())),
    {
      correctionRequest: true,
      payload: correctionPayload({
        request: "not rest first, start the middle with work",
        currentTimers: baseEightSteps,
        conversation: [
          {
            role: "user",
            text: "8 min warmup, 8 min cooldown, exactly 8 steps between them, 1 minute each, alternating rest work",
          },
        ],
      }),
    },
  );
}

function addCountStressSpecs(add) {
  addCountedMiddleStressSpecs(add);
  addCountedPairStressSpecs(add);
  addCountedGenericStressSpecs(add);
}

function addExplicitLabelCopyStressSpecs(add) {
  const labelGroups = [
    [
      ["Plank", "other"],
      ["Squats", "other"],
      ["Rest", "rest"],
    ],
    [
      ["Jumping jacks", "other"],
      ["Pushups", "other"],
      ["Recovery", "rest"],
      ["Mountain climbers", "other"],
    ],
    [
      ["Warmup", "warmup"],
      ["Hard effort", "work"],
      ["Easy spin", "rest"],
      ["Warmdown", "cooldown"],
    ],
    [
      ["Breath", "other"],
      ["Hold", "other"],
      ["Reset", "other"],
    ],
    [
      ["Dead bug", "other"],
      ["Side plank", "other"],
      ["Hollow hold", "other"],
      ["Rest", "rest"],
      ["Bear crawl", "other"],
    ],
    [
      ["Prep", "other"],
      ["Work", "work"],
      ["Rest", "rest"],
      ["Cooldown", "cooldown"],
    ],
    [
      ["Lunges", "other"],
      ["Wall sit", "other"],
      ["High intensity", "work"],
      ["Low intensity", "rest"],
    ],
    [
      ["Box step ups", "other"],
      ["Battle ropes", "other"],
      ["Kettlebell swing", "other"],
      ["Rest", "rest"],
    ],
    [
      ["Round A", "other"],
      ["Round B", "other"],
      ["Round C", "other"],
    ],
    [
      ["Focus", "other"],
      ["Breathe out", "other"],
      ["Shake out", "other"],
      ["Recover", "rest"],
    ],
  ];
  const durationSets = [
    [30, 45, 60],
    [20, 10, 20, 10],
    [120, 30, 30, 120],
    [15, 45, 15],
    [40, 40, 20, 30, 40],
    [60, 90, 45, 120],
    [30, 30, 45, 45],
    [50, 25, 50, 25],
    [75, 75, 75],
    [10, 20, 10, 30],
    [90, 45, 90],
    [180, 30, 30, 180],
  ];

  let variant = 0;
  for (const labels of labelGroups) {
    for (const durations of durationSets) {
      const count = Math.min(labels.length, durations.length);
      const timers = Array.from({ length: count }, (_, index) => {
        const [label, kind] = labels[index];
        return timer(label, durations[index], kind);
      });
      const parts = timers.map((entry, index) => explicitSequencePart(entry, variant + index));
      const templates = [
        parts.join(", "),
        `Use this exact sequence: ${parts.join("; ")}`,
        `Create timers ${parts.join(", then ")}`,
        `Set up ${parts.join(" / ")}`,
      ];
      add("explicit-label-copy", templates[variant % templates.length], timers);
      variant += 1;
    }
  }
}

function addExplicitLabelCopyTrainOnlySpecs(add) {
  const threeStepLabels = [
    [
      ["Plank", "other"],
      ["Squats", "other"],
      ["Rest", "rest"],
    ],
    [
      ["Lunges", "other"],
      ["Wall sit", "other"],
      ["Rest", "rest"],
    ],
    [
      ["Plank hold", "other"],
      ["Squat hold", "other"],
      ["Recovery", "rest"],
    ],
    [
      ["Situps", "other"],
      ["Glute bridge", "other"],
      ["Rest", "rest"],
    ],
    [
      ["Bear plank", "other"],
      ["Fast feet", "other"],
      ["Easy", "rest"],
    ],
  ];
  const threeStepDurations = [
    [30, 45, 60],
    [30, 45, 60],
    [20, 40, 60],
    [45, 30, 60],
    [35, 45, 75],
    [15, 45, 60],
    [30, 30, 60],
  ];

  let variant = 0;
  for (const labels of threeStepLabels) {
    for (const durations of threeStepDurations) {
      addExplicitTrainOnly(add, labels, durations, variant++);
    }
  }

  const sandwichedRestLabels = [
    [
      ["Bird dog", "other"],
      ["Side plank", "other"],
      ["Hollow hold", "other"],
      ["Rest", "rest"],
      ["Bear crawl", "other"],
    ],
    [
      ["Skaters", "other"],
      ["Pushups", "other"],
      ["Mountain climbers", "other"],
      ["Recovery", "rest"],
      ["Burpees", "other"],
    ],
    [
      ["Round A", "other"],
      ["Round B", "other"],
      ["Round C", "other"],
      ["Rest", "rest"],
      ["Round D", "other"],
    ],
    [
      ["March", "other"],
      ["Reach", "other"],
      ["Balance", "other"],
      ["Easy", "rest"],
      ["Sprint", "other"],
    ],
  ];
  const sandwichedRestDurations = [
    [40, 40, 20, 30, 40],
    [30, 30, 20, 30, 30],
    [45, 45, 15, 30, 45],
    [20, 40, 20, 30, 40],
    [50, 25, 50, 25, 50],
    [60, 30, 30, 30, 60],
  ];

  for (const labels of sandwichedRestLabels) {
    for (const durations of sandwichedRestDurations) {
      addExplicitTrainOnly(add, labels, durations, variant++);
    }
  }
}

function addExplicitTrainOnly(add, labels, durations, variant) {
  const count = Math.min(labels.length, durations.length);
  const timers = Array.from({ length: count }, (_, index) => {
    const [label, kind] = labels[index];
    return timer(label, durations[index], kind);
  });
  const parts = timers.map((entry, index) => explicitSequencePart(entry, variant + index));
  const templates = [
    parts.join(", "),
    `Use this exact sequence: ${parts.join("; ")}`,
    `Create timers ${parts.join(", then ")}`,
    `Sequence only: ${parts.join(" / ")}`,
  ];
  add("explicit-label-copy-train", templates[variant % templates.length], timers, { split: "train" });
}

function addCountedMiddleStressSpecs(add) {
  const endpoints = [
    [4, 4],
    [5, 5],
    [6, 4],
    [8, 6],
    [10, 8],
    [12, 10],
  ];
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16];
  const durations = [15, 20, 30, 45, 60, 75, 90];
  const orders = [
    { words: "work/rest", phrase: "work then rest", order: ["work", "rest"] },
    { words: "rest/work", phrase: "rest then work", order: ["rest", "work"] },
  ];

  let variant = 0;
  for (const count of counts) {
    for (const durationSeconds of durations) {
      for (const order of orders) {
        const [warmupMinutes, cooldownMinutes] = endpoints[variant % endpoints.length];
        const countValue = wordOrNumber(count, variant);
        const duration = durationText(durationSeconds);
        const timers = withEndpoints(
          warmupMinutes,
          cooldownMinutes,
          alternating(count, order.order, durationSeconds, workRestLabels()),
        );
        const templates = [
          `${warmupMinutes} min warmup, exactly ${countValue} total middle timers, ${duration} each, alternating ${order.phrase}, ${cooldownMinutes} min cooldown`,
          `After ${minuteText(warmupMinutes, variant)} warmup and before ${minuteText(cooldownMinutes, variant + 1)} cooldown, put ${countValue} separate ${duration} intervals, ${order.words}`,
          `Build ${warmupMinutes} minute warmup, ${countValue} middle intervals total, start with ${order.order[0]}, ${duration} each, then ${cooldownMinutes} minute cooldown`,
          `Warmup ${warmupMinutes} min and cooldown ${cooldownMinutes} min; in between there are exactly ${countValue} ${duration} work/rest timers, ${order.phrase}`,
        ];
        add("count-middle", templates[variant % templates.length], timers);
        variant += 1;
      }
    }
  }
}

function addCountedPairStressSpecs(add) {
  const endpoints = [
    [4, 4],
    [5, 5],
    [8, 6],
    [10, 8],
  ];
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12];
  const durationPairs = [
    [20, 10],
    [30, 15],
    [40, 20],
    [45, 15],
    [60, 30],
    [90, 30],
  ];
  const orders = [
    { first: "work", second: "rest", words: "work/rest" },
    { first: "rest", second: "work", words: "rest/work" },
  ];
  const nouns = ["rounds", "blocks", "cycles", "sets"];

  let variant = 0;
  for (const count of counts) {
    for (const [workSeconds, restSeconds] of durationPairs) {
      for (const order of orders) {
        const [warmupMinutes, cooldownMinutes] = endpoints[variant % endpoints.length];
        const noun = nouns[variant % nouns.length];
        const countValue = wordOrNumber(count, variant);
        const firstSeconds = order.first === "work" ? workSeconds : restSeconds;
        const secondSeconds = order.second === "work" ? workSeconds : restSeconds;
        const firstDuration = durationText(firstSeconds);
        const secondDuration = durationText(secondSeconds);
        const timers = withEndpoints(
          warmupMinutes,
          cooldownMinutes,
          pairs(count, [order.first, order.second], workSeconds, restSeconds, workRestLabels()),
        );
        const templates = [
          `${warmupMinutes} min warmup, ${countValue} ${noun}, each ${noun.slice(0, -1)} has ${firstDuration} ${order.first} then ${secondDuration} ${order.second}, ${cooldownMinutes} min cooldown`,
          `Do exactly ${countValue} ${order.words} pairs after ${warmupMinutes} minutes warmup: ${durationText(workSeconds)} work and ${durationText(restSeconds)} rest, then ${cooldownMinutes} minutes cooldown`,
          `Start with ${warmupMinutes} min warm up, repeat ${countValue} ${noun} of ${firstDuration} ${order.first} plus ${secondDuration} ${order.second}, finish ${cooldownMinutes} min cool down`,
          `${countValue} full ${noun}, not ${countValue} total intervals: ${durationText(workSeconds)} work and ${durationText(restSeconds)} rest in every ${noun.slice(0, -1)}, with ${warmupMinutes} min warmup and ${cooldownMinutes} min cooldown`,
        ];
        add("count-pairs", templates[variant % templates.length], timers);
        variant += 1;
      }
    }
  }
}

function addCountedGenericStressSpecs(add) {
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 15, 20];
  const durations = [10, 15, 20, 30, 45, 60, 90, 120, 300];

  let variant = 0;
  for (const count of counts) {
    for (const durationSeconds of durations) {
      const countValue = wordOrNumber(count, variant);
      const duration = durationText(durationSeconds);
      const timers = genericTimers([[count, durationSeconds]]);
      const templates = [
        `Create exactly ${countValue} standalone timers, ${duration} each`,
        `I need ${countValue} plain ${duration} intervals`,
        `Make ${countValue} separate timers of ${duration}; no warmup or cooldown`,
        `${countValue} timers only, each one should last ${duration}`,
      ];
      add("count-generic", templates[variant % templates.length], timers);
      variant += 1;
    }
  }
}

function correctionPayload({ request, currentTimers, conversation }) {
  return {
    correctionRequest: true,
    userRequest: request,
    conversation,
    currentWorkoutShape: workoutShape(currentTimers),
    currentTimers: currentTimers.map(({ label, durationSeconds, kind }) => ({
      label,
      durationSeconds,
      kind,
    })),
  };
}

function workoutShape(timers) {
  const middle = timers.filter((entry) => entry.kind === "work" || entry.kind === "rest");
  const totalSeconds = timers.reduce((total, entry) => total + entry.durationSeconds, 0);
  return {
    intervalCount: timers.length,
    totalSeconds,
    warmup: timers.find((entry) => entry.kind === "warmup") ?? null,
    cooldown: [...timers].reverse().find((entry) => entry.kind === "cooldown") ?? null,
    middle: {
      intervalCount: middle.length,
      cycleCount: Math.floor(middle.length / 2),
      hasAlternatingPattern: middle.length > 1,
      order: middle.slice(0, 2).map((entry) => entry.kind),
      startsWith: middle[0]?.kind ?? null,
      endsWith: middle[middle.length - 1]?.kind ?? null,
      workDurationsSeconds: uniqueDurations(middle, "work"),
      restDurationsSeconds: uniqueDurations(middle, "rest"),
    },
  };
}

function uniqueDurations(timers, kind) {
  return [...new Set(timers.filter((entry) => entry.kind === kind).map((entry) => entry.durationSeconds))];
}

function withEndpoints(warmupMinutes, cooldownMinutes, middleTimers) {
  const timers = [
    timer("Warmup", warmupMinutes * 60, "warmup"),
    ...middleTimers,
    timer("Cooldown", cooldownMinutes * 60, "cooldown"),
  ];
  const middleHint = TIMER_DSL_HINTS.get(middleTimers);
  if (middleHint) {
    TIMER_DSL_HINTS.set(timers, {
      type: "withEndpoints",
      middleHint,
    });
  }
  return timers;
}

function alternating(count, order, seconds, labels) {
  const timers = [];
  for (let index = 0; index < count; index += 1) {
    const kind = order[index % order.length];
    timers.push(timer(labels[kind], seconds, kind));
  }
  TIMER_DSL_HINTS.set(timers, {
    type: "alt",
    count,
    atoms: order.map((kind) => timer(labels[kind], seconds, kind)),
  });
  return timers;
}

function pairs(count, order, workSeconds, restSeconds, labels) {
  const timers = [];
  for (let index = 0; index < count; index += 1) {
    for (const kind of order) {
      timers.push(timer(labels[kind], kind === "work" ? workSeconds : restSeconds, kind));
    }
  }
  TIMER_DSL_HINTS.set(timers, {
    type: "block",
    count,
    atoms: order.map((kind) => timer(labels[kind], kind === "work" ? workSeconds : restSeconds, kind)),
  });
  return timers;
}

function genericTimers(groups) {
  const timers = [];
  for (const [count, seconds] of groups) {
    for (let index = 0; index < count; index += 1) {
      timers.push(timer(`Timer ${timers.length + 1}`, seconds, "other"));
    }
  }
  TIMER_DSL_HINTS.set(timers, {
    type: "generic",
    groups,
  });
  return timers;
}

function timer(label, durationSeconds, kind) {
  return { label, durationSeconds, kind };
}

function workRestLabels() {
  return { work: "Work", rest: "Rest" };
}

function highLowLabels() {
  return { work: "High intensity", rest: "Low intensity" };
}

function hardEasyLabels() {
  return { work: "Hard", rest: "Easy" };
}

function minuteText(minutes, variant = 0) {
  const number = wordOrNumber(minutes, variant);
  const unit = minutes === 1 ? "minute" : "minutes";
  return variant % 3 === 0 ? `${number} ${unit}` : `${minutes} min`;
}

function durationText(seconds) {
  if (seconds === 90) return "1 minute 30 seconds";
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  }
  return `${seconds} seconds`;
}

function explicitSequencePart(entry, variant = 0) {
  const duration =
    variant % 3 === 0
      ? formatCompactDuration(entry.durationSeconds)
      : durationText(entry.durationSeconds).replace("seconds", "sec").replace("minutes", "min").replace("minute", "min");
  return `${duration}: ${entry.label}`;
}

function wordOrNumber(value, variant) {
  return variant % 4 === 0 && WORD_NUMBERS[value] ? WORD_NUMBERS[value] : String(value);
}

function parseJsonObject(content, context) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new Error(`${context}: invalid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${context}: expected JSON object`);
  }
  return parsed;
}

function withoutSplit(record) {
  const { split, ...rest } = record;
  return rest;
}

function compareIds(left, right) {
  return left.id.localeCompare(right.id);
}

function stableHash(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function assertUserFormat(userFormat) {
  if (!["app", "natural"].includes(userFormat)) {
    throw new Error(`Unknown user format "${userFormat}". Use "app" or "natural".`);
  }
}

function assertTargetFormat(targetFormat) {
  if (!["json", "dsl"].includes(targetFormat)) {
    throw new Error(`Unknown target format "${targetFormat}". Use "json" or "dsl".`);
  }
}
