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

export const DATASET_VERSION = "2026-05-18";
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
  "For ordered generic timer groups, including matching bookends, use duration + Nxduration + duration: label.",
  "Use Nx duration: label | duration: label to repeat a full block N times.",
  "Use Nalt duration: label | duration: label for N total alternating timers.",
  "Example output: 8m: Warmup\\n5alt 45s: Rest | 45s: Work\\n9m: Cooldown.",
  "Example generic output: 4m + 5x30s + 4m: Timer.",
  "Warmup and cooldown are separate lines when requested.",
  "Intervals, steps, timers, alterations, and alternations are individual middle timers unless the request says each block, round, cycle, set, or step contains both rest and work.",
  "Blocks, rounds, cycles, and sets of rest/work are repeated pairs.",
  "Use Timer as the label for repeated generic timers; do not number generic timer labels.",
  "Use only the request and supplied correction context. Do not copy defaults.",
].join(" ");
export const ACTION_SYSTEM_PROMPT = [
  "You convert natural-language workout timer requests into a Timey action plan.",
  "The user message keeps the raw request and includes extracted slots for timer atoms, durations, counts, and labels.",
  "Return only action commands using those slots.",
  "When A atom slots are present, use ADD atom, REP count atom, BLOCK count atom atom, and ALT count atom atom.",
  "Otherwise use ADD duration label, REP count duration label, BLOCK count duration label duration label, and ALT count duration label duration label.",
  "Use slot ids exactly, such as A0, D0, C0, and L0. Do not write raw durations, counts, or labels.",
  "Finish with END on its own final line.",
].join(" ");
export const SYSTEM_PROMPT = JSON_SYSTEM_PROMPT;
export const QWEN3_NO_THINK_SYSTEM_PROMPT = `${SYSTEM_PROMPT} /no_think`;
export const QWEN3_DSL_NO_THINK_SYSTEM_PROMPT = `${DSL_SYSTEM_PROMPT} /no_think`;
export const QWEN3_ACTION_NO_THINK_SYSTEM_PROMPT = `${ACTION_SYSTEM_PROMPT} /no_think`;

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
  includePhase4HardData = false,
  includeUserRequestExpansion = false,
  includePhase4HResidualData = false,
  includePhase4IBrowserResidualData = false,
  targetFormat = DEFAULT_TARGET_FORMAT,
  userFormat = DEFAULT_USER_FORMAT,
  systemPrompt = null,
} = {}) {
  assertTargetFormat(targetFormat);
  assertUserFormat(userFormat);

  const records = [];
  const seen = new Set();
  const baseSystemPrompt =
    systemPrompt ?? (targetFormat === "dsl" ? DSL_SYSTEM_PROMPT : targetFormat === "actions" ? ACTION_SYSTEM_PROMPT : JSON_SYSTEM_PROMPT);
  const resolvedSystemPrompt =
    targetFormat === "dsl" && dslEndToken
      ? `${baseSystemPrompt} Finish with ${DSL_END_TOKEN} on its own final line.`
      : baseSystemPrompt;

  for (const spec of buildSpecs({
    includePhase4HardData,
    includeUserRequestExpansion,
    includePhase4HResidualData,
    includePhase4IBrowserResidualData,
  })) {
    if ((userFormat === "natural" || userFormat === "lossless-slots" || userFormat === "lossless-atoms") && spec.correctionRequest) continue;

    const actionSlots =
      targetFormat === "actions" && (userFormat === "lossless-slots" || userFormat === "lossless-atoms")
        ? extractLosslessActionSlots(spec.request, { includeAtoms: userFormat === "lossless-atoms" })
        : null;
    const atomActions = userFormat === "lossless-atoms";
    let actionTarget = null;
    if (targetFormat === "actions") {
      try {
        actionTarget = formatTimerActions(spec.timers, { slots: actionSlots, atomActions });
      } catch (error) {
        if (
          (userFormat === "lossless-slots" || userFormat === "lossless-atoms") &&
          spec.split === "train" &&
          /^action slots: missing (?:atom|duration|count|label) slot /.test(error.message)
        ) {
          continue;
        }
        throw new Error(`${spec.category} request ${JSON.stringify(spec.request)}: ${error.message}`);
      }
    }
    const assistantContent =
      targetFormat === "dsl"
        ? formatTimerDsl(spec.timers, { endToken: dslEndToken })
        : targetFormat === "actions"
          ? actionTarget.content
          : JSON.stringify({ timers: spec.timers });
    const userContent =
      userFormat === "natural" || userFormat === "lossless-slots" || userFormat === "lossless-atoms"
        ? formatUserContent(spec.request, actionTarget, { userFormat })
        : JSON.stringify({
            ...(spec.payload ?? { correctionRequest: false, userRequest: spec.request }),
            ...(actionTarget ? { actionSlots: actionTarget.slots } : {}),
          });
    const duplicateKey = `${userContent}\n${assistantContent}`;
    if (seen.has(duplicateKey) && !spec.duplicateOk) continue;
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
        ...(actionTarget ? { actionSlots: actionTarget.slots } : {}),
        ...(spec.source ? { source: spec.source } : {}),
        ...(spec.sourceCategory ? { sourceCategory: spec.sourceCategory } : {}),
        ...(spec.hardValidation ? { hardValidation: true } : {}),
        ...(spec.duplicateOk ? { duplicateOk: true } : {}),
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
  const hardValidation = [];
  const flexibleByCategory = new Map();

  for (const record of records) {
    if (record.split === "train") {
      train.push(withoutSplit(record));
    } else if (record.split === "validation") {
      const prepared = withoutSplit(record);
      validation.push(prepared);
      if (prepared.metadata?.hardValidation) hardValidation.push(prepared);
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
      const prepared = withoutSplit(sorted[index]);
      const target = index < validationCount ? validation : train;
      target.push(prepared);
      if (index < validationCount && prepared.metadata?.hardValidation) hardValidation.push(prepared);
    }
  }

  return {
    train: train.sort(compareIds),
    validation: validation.sort(compareIds),
    hardValidation: hardValidation.sort(compareIds),
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
  if (!["json", "dsl", "actions"].includes(targetFormat)) {
    throw new Error(`${record.id}: invalid targetFormat ${JSON.stringify(targetFormat)}`);
  }
  if (
    typeof system.content !== "string" ||
    (targetFormat === "json" && !system.content.includes("Return only JSON")) ||
    (targetFormat === "dsl" && !system.content.includes("duration: label")) ||
    (targetFormat === "actions" && !system.content.includes("action commands"))
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
  if ((record.userFormat === "lossless-slots" || record.userFormat === "lossless-atoms") && targetFormat !== "actions") {
    throw new Error(`${record.id}: ${record.userFormat} user format requires actions target format`);
  }

  const parsed =
    targetFormat === "dsl"
      ? parseTimerDsl(assistant.content, `${record.id}: assistant content`)
      : targetFormat === "actions"
        ? parseTimerActions(assistant.content, record.metadata?.actionSlots, `${record.id}: assistant content`)
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

export function formatTimerActions(timers, { slots = null, atomActions = false } = {}) {
  const slotter = slots ? createActionSlotResolver(slots, "action slots") : createActionSlotter();
  const commands = formatActionCommands(timers, slotter, { atomActions });
  return {
    content: [...commands, DSL_END_TOKEN].join("\n"),
    slots: slotter.toJSON(),
  };
}

export function parseTimerActions(content, slots, context = "timer actions") {
  const source = String(content ?? "").trim();
  if (!source) throw new Error(`${context}: empty action plan`);
  const slotMaps = createActionSlotMaps(slots, context);
  const tokens = source
    .split(/\s+|;/)
    .map(cleanActionToken)
    .filter(Boolean)
    .filter((token) => !/^(BEGIN|SEQ)$/i.test(token))
    .filter((token) => !new RegExp(`^${DSL_END_TOKEN}$`, "i").test(token));

  if (tokens.length < 1) throw new Error(`${context}: no action commands`);
  const dslLines = compileActionTokens(tokens, slotMaps, context);
  return parseTimerDsl(dslLines.join("\n"), context);
}

function formatUserContent(request, actionTarget, { userFormat = "natural" } = {}) {
  if (!actionTarget) return request;
  if (userFormat === "lossless-atoms") {
    return [
      `Request: ${request}`,
      `Counts: ${formatLosslessCountSlotsForPrompt(actionTarget.slots)}`,
      `Atoms: ${formatLosslessAtomSlotsForPrompt(actionTarget.slots)}`,
    ].join("\n");
  }
  const slots = userFormat === "lossless-slots" ? formatLosslessActionSlotsForPrompt(actionTarget.slots) : formatActionSlotsForPrompt(actionTarget.slots);
  return [`Request: ${request}`, `Slots: ${slots}`].join("\n");
}

function formatActionSlotsForPrompt(slots) {
  const values = [
    ...slots.durations.map((slot) => `${slot.id}=${slot.value}`),
    ...slots.counts.map((slot) => `${slot.id}=${slot.count}`),
    ...slots.labels.map((slot) => `${slot.id}=${slot.label}`),
  ];
  return values.join("; ");
}

function formatLosslessActionSlotsForPrompt(slots) {
  const values = [
    ...slots.durations.map((slot) => `${slot.id}@${formatSlotLocations(slot)}=${slot.value}`),
    ...slots.counts.map((slot) => `${slot.id}@${formatSlotLocations(slot)}=${slot.count}`),
    ...slots.labels.map((slot) => `${slot.id}@${formatSlotLocations(slot)}=${slot.label}`),
  ];
  return values.join("; ");
}

function formatLosslessCountSlotsForPrompt(slots) {
  return slots.counts.map((slot) => `${slot.id}@${formatSlotLocations(slot)}=${slot.count}`).join("; ") || "none";
}

function formatLosslessAtomSlotsForPrompt(slots) {
  return slots.atoms.map((slot) => `${slot.id}@${formatSlotLocations(slot)}=${slot.value}:${slot.label}`).join("; ");
}

function formatSlotLocations(slot) {
  const spans = slot.spans ?? (slot.span ? [slot.span] : []);
  if (spans.length === 0) return slot.source ?? "default";
  return spans.map((span) => `${span.start}:${span.end}`).join(",");
}

function createActionSlotter() {
  const durations = [];
  const counts = [];
  const labels = [];
  const atoms = [];
  const durationIds = new Map();
  const countIds = new Map();
  const labelIds = new Map();
  const atomIds = new Map();

  return {
    duration(seconds) {
      const normalized = Number(seconds);
      const key = String(normalized);
      if (!durationIds.has(key)) {
        durationIds.set(key, `D${durations.length}`);
        durations.push({ id: durationIds.get(key), seconds: normalized, value: formatCompactDuration(normalized) });
      }
      return durationIds.get(key);
    },
    count(count) {
      const normalized = Number(count);
      const key = String(normalized);
      if (!countIds.has(key)) {
        countIds.set(key, `C${counts.length}`);
        counts.push({ id: countIds.get(key), count: normalized });
      }
      return countIds.get(key);
    },
    label(label) {
      const normalized = normalizeActionLabel(label);
      if (!labelIds.has(normalized)) {
        labelIds.set(normalized, `L${labels.length}`);
        labels.push({ id: labelIds.get(normalized), label: normalized });
      }
      return labelIds.get(normalized);
    },
    atom(timer) {
      const normalized = normalizeComparableTimer(timer);
      const label = normalizeActionLabel(normalized.label);
      const key = `${normalized.durationSeconds}\u0000${label}`;
      if (!atomIds.has(key)) {
        const durationId = this.duration(normalized.durationSeconds);
        const labelId = this.label(label);
        atomIds.set(key, `A${atoms.length}`);
        atoms.push({
          id: atomIds.get(key),
          durationId,
          labelId,
          seconds: normalized.durationSeconds,
          value: formatCompactDuration(normalized.durationSeconds),
          label,
        });
      }
      return atomIds.get(key);
    },
    toJSON() {
      return { durations, counts, labels, atoms };
    },
  };
}

function createActionSlotResolver(slots, context) {
  const durations = normalizeLosslessSlotList(slots.durations, "durations", context);
  const counts = normalizeLosslessSlotList(slots.counts, "counts", context);
  const labels = normalizeLosslessSlotList(slots.labels, "labels", context);
  const atoms = normalizeLosslessSlotList(slots.atoms ?? [], "atoms", context);
  const durationIds = new Map();
  const countIds = new Map();
  const labelIds = new Map();
  const atomIds = new Map();

  for (const slot of durations) {
    const key = String(Number(slot.seconds));
    if (!durationIds.has(key)) durationIds.set(key, slot.id);
  }
  for (const slot of counts) {
    const key = String(Number(slot.count));
    if (!countIds.has(key)) countIds.set(key, slot.id);
  }
  for (const slot of labels) {
    const key = normalizeActionLabel(slot.label);
    if (!labelIds.has(key)) labelIds.set(key, slot.id);
  }
  for (const slot of atoms) {
    const key = `${Number(slot.seconds)}\u0000${normalizeActionLabel(slot.label)}`;
    if (!atomIds.has(key)) atomIds.set(key, slot.id);
  }

  return {
    duration(seconds) {
      const id = durationIds.get(String(Number(seconds)));
      if (!id) throw new Error(`${context}: missing duration slot for ${formatCompactDuration(Number(seconds))}`);
      return id;
    },
    count(count) {
      const id = countIds.get(String(Number(count)));
      if (!id) throw new Error(`${context}: missing count slot for ${count}`);
      return id;
    },
    label(label) {
      const id = labelIds.get(normalizeActionLabel(label));
      if (!id) throw new Error(`${context}: missing label slot for ${JSON.stringify(normalizeActionLabel(label))}`);
      return id;
    },
    atom(timer) {
      const normalized = normalizeComparableTimer(timer);
      const id = atomIds.get(`${Number(normalized.durationSeconds)}\u0000${normalizeActionLabel(normalized.label)}`);
      if (!id) {
        throw new Error(
          `${context}: missing atom slot for ${formatCompactDuration(Number(normalized.durationSeconds))}:${JSON.stringify(
            normalizeActionLabel(normalized.label),
          )}`,
        );
      }
      return id;
    },
    toJSON() {
      return { durations, counts, labels, atoms };
    },
  };
}

function normalizeLosslessSlotList(value, name, context) {
  if (!Array.isArray(value)) throw new Error(`${context}: ${name} must be an array`);
  return value.map((slot, index) => {
    if (!slot || typeof slot !== "object") throw new Error(`${context}: ${name} ${index + 1} must be an object`);
    return { ...slot };
  });
}

function normalizeActionLabel(label) {
  return isNumberedGenericTimerLabel(label) ? "Timer" : String(label);
}

export function extractLosslessActionSlots(request, { includeAtoms = false } = {}) {
  const source = String(request ?? "");
  const durationCandidates = extractDurationCandidates(source);
  const durations = mergeDurationCandidates(durationCandidates);
  const counts = mergeCountCandidates(extractCountCandidates(source, durationCandidates));
  const labels = mergeLabelCandidates(extractLabelCandidates(source));

  if (hasImplicitWorkoutDurationCue(source)) {
    for (const seconds of [60, 30, 45, 20, 15, 10]) {
      if (!durations.some((slot) => slot.seconds === seconds)) {
        durations.push(defaultDurationSlot(seconds));
      }
    }
  }
  if (labels.some((slot) => slot.label === "Work") && !labels.some((slot) => slot.label === "Rest")) {
    labels.push(defaultLabelSlot("Rest", "paired-default"));
  }
  if (labels.some((slot) => slot.label === "Rest") && !labels.some((slot) => slot.label === "Work")) {
    labels.push(defaultLabelSlot("Work", "paired-default"));
  }
  if (!labels.some((slot) => slot.label === "Timer")) {
    labels.push(defaultLabelSlot("Timer"));
  }

  assignSlotIds(durations, "D");
  assignSlotIds(counts, "C");
  assignSlotIds(labels, "L");
  const atoms = includeAtoms ? buildLosslessAtomSlots(source, durations, labels) : [];
  assignSlotIds(atoms, "A");

  return { durations, counts, labels, atoms };
}

const SIMPLE_NUMBER_WORD_VALUES = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const NUMBER_WORD_TENS = ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const NUMBER_WORD_ONES = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const NUMBER_WORD_PATTERN = [
  "a",
  "an",
  ...Object.keys(SIMPLE_NUMBER_WORD_VALUES).filter((word) => word !== "a" && word !== "an"),
  ...NUMBER_WORD_TENS.flatMap((ten) => NUMBER_WORD_ONES.map((one) => `${ten}[ -]+${one}`)),
]
  .sort((left, right) => right.length - left.length)
  .join("|");
const NUMBER_PHRASE_PATTERN = `(?:\\d+|${NUMBER_WORD_PATTERN})`;
const MINUTE_UNIT_PATTERN = String.raw`(?:minutes?|mins?|minu|m)`;
const SECOND_UNIT_PATTERN = String.raw`(?:seconds?|secs?|sec|s)`;
const LABEL_PHRASES = [
  ["high intensity", "High intensity"],
  ["low intensity", "Low intensity"],
  ["hard effort", "Hard effort"],
  ["easy spin", "Easy spin"],
  ["breathing reset", "Breathing reset"],
  ["breathe out", "Breathe out"],
  ["battle ropes", "Battle ropes"],
  ["bear crawl", "Bear crawl"],
  ["bear plank", "Bear plank"],
  ["bird dog", "Bird dog"],
  ["box step ups", "Box step ups"],
  ["dead bug", "Dead bug"],
  ["fast feet", "Fast feet"],
  ["glute bridge", "Glute bridge"],
  ["hollow hold", "Hollow hold"],
  ["jump rope", "Jump rope"],
  ["jumping jacks", "Jumping jacks"],
  ["kettlebell swing", "Kettlebell swing"],
  ["mountain climbers", "Mountain climbers"],
  ["plank hold", "Plank hold"],
  ["shadow boxing", "Shadow boxing"],
  ["shake out", "Shake out"],
  ["side plank", "Side plank"],
  ["squat hold", "Squat hold"],
  ["wall sit", "Wall sit"],
  ["round a", "Round A"],
  ["round b", "Round B"],
  ["round c", "Round C"],
  ["round d", "Round D"],
  ["warm down", "Warmdown"],
  ["warmdown", "Warmdown"],
  ["cool down", "Cooldown"],
  ["cooldown", "Cooldown"],
  ["warm up", "Warmup"],
  ["warmup", "Warmup"],
  ["recovery", "Recovery"],
  ["recovery", "Rest"],
  ["recover", "Recover"],
  ["recover", "Rest"],
  ["pushups", "Pushups"],
  ["burpees", "Burpees"],
  ["lunges", "Lunges"],
  ["skaters", "Skaters"],
  ["situps", "Situps"],
  ["squats", "Squats"],
  ["sprint", "Sprint"],
  ["plank", "Plank"],
  ["breath", "Breath"],
  ["focus", "Focus"],
  ["march", "March"],
  ["reach", "Reach"],
  ["balance", "Balance"],
  ["prep", "Prep"],
  ["reset", "Reset"],
  ["work", "Work"],
  ["rest", "Rest"],
  ["hard", "Hard"],
  ["easy", "Easy"],
  ["hold", "Hold"],
].sort((left, right) => right[0].length - left[0].length);

function extractDurationCandidates(source) {
  const candidates = [];
  const add = (start, end, seconds, raw, sourceType = "text") => {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    candidates.push({
      seconds,
      value: formatCompactDuration(seconds),
      span: { start, end },
      spans: [{ start, end }],
      raw,
      raws: [raw],
      source: sourceType,
    });
  };

  collectRegex(source, /\b(\d{1,2}):([0-5]\d)\b/g, (match, start, end) => {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    add(start, end, minutes * 60 + seconds, match[0]);
  });

  collectRegex(source, /\b(?:half[\s-]+a|a[\s-]+half)[\s-]+minutes?\b/gi, (match, start, end) => {
    add(start, end, 30, match[0]);
  });

  collectRegex(source, new RegExp(`\\b(${NUMBER_PHRASE_PATTERN})[\\s-]+and[\\s-]+a[\\s-]+half[\\s-]+minutes?\\b`, "gi"), (match, start, end) => {
    const value = parseNumberPhrase(match[1]);
    if (value !== null) add(start, end, value * 60 + 30, match[0]);
  });

  collectRegex(
    source,
    new RegExp(`\\b(${NUMBER_PHRASE_PATTERN})\\s*${MINUTE_UNIT_PATTERN}[\\s-]*(${NUMBER_PHRASE_PATTERN})\\s*${SECOND_UNIT_PATTERN}\\b`, "gi"),
    (match, start, end) => {
      const minutes = parseNumberPhrase(match[1]);
      const seconds = parseNumberPhrase(match[2]);
      if (minutes !== null && seconds !== null) add(start, end, minutes * 60 + seconds, match[0]);
    },
  );

  collectRegex(
    source,
    new RegExp(`\\b(${NUMBER_PHRASE_PATTERN})\\s*${MINUTE_UNIT_PATTERN}\\b`, "gi"),
    (match, start, end) => {
      const value = parseNumberPhrase(match[1]);
      if (value !== null) add(start, end, value * 60, match[0]);
    },
  );

  collectRegex(
    source,
    new RegExp(`\\b(${NUMBER_PHRASE_PATTERN})\\s*${SECOND_UNIT_PATTERN}\\b`, "gi"),
    (match, start, end) => {
      const value = parseNumberPhrase(match[1]);
      if (value !== null) add(start, end, value, match[0]);
    },
  );

  return selectNonOverlapping(candidates);
}

function extractCountCandidates(source, durationCandidates) {
  const durationSpans = durationCandidates.flatMap((candidate) => candidate.spans ?? [candidate.span]).filter(Boolean);
  const candidates = [];

  collectRegex(source, new RegExp(`\\b(${NUMBER_PHRASE_PATTERN})\\b`, "gi"), (match, start, end) => {
    if (durationSpans.some((span) => spansOverlap({ start, end }, span))) return;
    const count = parseNumberPhrase(match[1]);
    if (count === null || count < 1 || count > MAX_INTERVALS) return;
    candidates.push({
      count,
      span: { start, end },
      spans: [{ start, end }],
      raw: match[0],
      raws: [match[0]],
      source: "text",
    });
  });

  return candidates;
}

function extractLabelCandidates(source) {
  const candidates = [];
  const add = (start, end, label, raw, sourceType = "text") => {
    const normalized = normalizeActionLabel(label.trim().replace(/\s+/g, " "));
    if (!normalized) return;
    candidates.push({
      label: normalized,
      span: { start, end },
      spans: [{ start, end }],
      raw,
      raws: [raw],
      source: sourceType,
    });
  };

  collectRegex(source, /:\s*([^,;/\n]+?)(?=\s*(?:,|;|\/|\n|$|\bthen\b))/gi, (match, start) => {
    const raw = match[1].trim();
    if (raw.includes(":")) return;
    if (new RegExp(`\\b(?:${MINUTE_UNIT_PATTERN}|${SECOND_UNIT_PATTERN})\\b`, "i").test(raw)) return;
    const leadingWhitespace = match[1].match(/^\s*/)?.[0].length ?? 0;
    const labelStart = start + match[0].indexOf(match[1]) + leadingWhitespace;
    add(labelStart, labelStart + raw.length, raw, raw);
  });

  for (const [phrase, label] of LABEL_PHRASES) {
    const pattern = phrase.replace(/\s+/g, String.raw`[\s-]+`);
    collectRegex(source, new RegExp(`(?<![A-Za-z])${pattern}(?![A-Za-z])`, "gi"), (match, start, end) => {
      add(start, end, label, match[0]);
    });
  }
  if (/\bhard\b/i.test(source)) {
    collectRegex(source, /(?<![A-Za-z])rest(?![A-Za-z])/gi, (match, start, end) => {
      add(start, end, "Easy", match[0]);
    });
  }

  return selectNonOverlapping(candidates, { allowExactSpanOverlap: true });
}

function mergeDurationCandidates(candidates) {
  const merged = mergeCandidates(candidates, (candidate) => String(candidate.seconds));
  return merged.map((slot) => ({
    seconds: slot.seconds,
    value: slot.value,
    span: slot.spans[0] ?? null,
    spans: slot.spans,
    raw: slot.raws[0] ?? "",
    raws: slot.raws,
    source: slot.source,
  }));
}

function mergeCountCandidates(candidates) {
  const merged = mergeCandidates(candidates, (candidate) => String(candidate.count));
  return merged.map((slot) => ({
    count: slot.count,
    span: slot.spans[0] ?? null,
    spans: slot.spans,
    raw: slot.raws[0] ?? "",
    raws: slot.raws,
    source: slot.source,
  }));
}

function mergeLabelCandidates(candidates) {
  const merged = mergeCandidates(candidates, (candidate) => normalizeActionLabel(candidate.label));
  return merged.map((slot) => ({
    label: slot.label,
    span: slot.spans[0] ?? null,
    spans: slot.spans,
    raw: slot.raws[0] ?? "",
    raws: slot.raws,
    source: slot.source,
  }));
}

function mergeCandidates(candidates, keyForCandidate) {
  const byKey = new Map();
  for (const candidate of candidates) {
    const key = keyForCandidate(candidate);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...candidate, spans: [...(candidate.spans ?? [])], raws: [...(candidate.raws ?? [])] });
      continue;
    }
    for (const span of candidate.spans ?? []) {
      if (!existing.spans.some((known) => known.start === span.start && known.end === span.end)) {
        existing.spans.push(span);
      }
    }
    for (const raw of candidate.raws ?? []) {
      if (!existing.raws.includes(raw)) existing.raws.push(raw);
    }
  }
  return [...byKey.values()].sort(compareCandidateLocations);
}

function defaultDurationSlot(seconds, source = "default") {
  return {
    seconds,
    value: formatCompactDuration(seconds),
    span: null,
    spans: [],
    raw: "",
    raws: [],
    source,
  };
}

function defaultLabelSlot(label, source = "default") {
  return {
    label,
    span: null,
    spans: [],
    raw: "",
    raws: [],
    source,
  };
}

function buildLosslessAtomSlots(source, durations, labels) {
  const atoms = [];
  const byKey = new Map();
  const timerLabel = labels.find((slot) => slot.label === "Timer");
  const workoutLabels = labels.filter((slot) => isWorkoutAtomLabel(slot.label) && hasUsefulWorkoutAtomSignal(source, slot));
  const endpointLabels = labels.filter((slot) => isEndpointAtomLabel(slot.label));
  const explicitLabels = labels.filter((slot) => !isWorkoutAtomLabel(slot.label) && !isEndpointAtomLabel(slot.label) && slot.label !== "Timer");
  const explicitDurations = durations.filter((slot) => (slot.spans?.length ?? 0) > 0);
  const explicitSmallDurations = explicitDurations.filter((slot) => slot.seconds <= 180);
  const defaultSmallDurations = durations.filter((slot) => slot.seconds <= 180 && (slot.spans?.length ?? 0) === 0);

  addExplicitColonAtomCandidates(source, durations, labels, atoms, byKey);

  if (timerLabel) {
    const timerDurations = explicitDurations.length ? explicitDurations : durations;
    for (const duration of timerDurations) addAtomCandidate(atoms, byKey, duration, timerLabel, "generic");
  }

  for (const label of endpointLabels) {
    for (const duration of nearestDurationSlots(label, explicitDurations, 1, { maxDistance: 25 })) {
      addAtomCandidate(atoms, byKey, duration, label, "nearby");
    }
  }

  for (const label of explicitLabels) {
    for (const duration of nearestDurationSlots(label, explicitDurations, 1, { maxDistance: 30 })) {
      addAtomCandidate(atoms, byKey, duration, label, "nearby");
    }
  }

  for (const label of workoutLabels) {
    const nearbyDurations = label.spans?.length ? nearestDurationSlots(label, explicitSmallDurations, 1, { maxDistance: 25 }) : [];
    const fallbackDurations = explicitSmallDurations.length ? explicitSmallDurations : defaultSmallDurations;
    const selectedDurations = nearbyDurations.length ? nearbyDurations : fallbackDurations;
    for (const duration of selectedDurations) {
      addAtomCandidate(atoms, byKey, duration, label, duration.spans?.length ? "workout" : "default-workout");
    }
  }

  const defaultLabel = labels.find((slot) => slot.label === "Timer");
  if (defaultLabel && atoms.length === 0) {
    for (const duration of durations) addAtomCandidate(atoms, byKey, duration, defaultLabel, "fallback");
  }

  return atoms.sort(compareCandidateLocations);
}

function addExplicitColonAtomCandidates(source, durations, labels, atoms, byKey) {
  for (const duration of durations) {
    for (const span of duration.spans ?? []) {
      const colonSearch = source.slice(span.end, span.end + 4);
      const colonOffset = colonSearch.indexOf(":");
      if (colonOffset < 0) continue;
      if (source.slice(span.end, span.end + colonOffset).trim()) continue;

      const colonIndex = span.end + colonOffset;
      const labelMatch = source.slice(colonIndex + 1).match(/^\s*([^,;/\n]+?)(?=\s*(?:,|;|\/|\n|$|\bthen\b))/i);
      if (!labelMatch) continue;
      const raw = labelMatch[1].trim();
      if (!raw || raw.includes(":")) continue;

      const leadingWhitespace = labelMatch[0].indexOf(labelMatch[1]);
      const labelStart = colonIndex + 1 + leadingWhitespace;
      const labelEnd = labelStart + raw.length;
      const label = findLabelSlotForSpan(labels, labelStart, labelEnd, raw);
      if (!label) continue;
      addAtomCandidate(atoms, byKey, { ...duration, spans: [span], span }, { ...label, spans: [{ start: labelStart, end: labelEnd }], span: { start: labelStart, end: labelEnd } }, "colon");
    }
  }
}

function findLabelSlotForSpan(labels, start, end, raw) {
  const exact = labels.find((label) => (label.spans ?? []).some((span) => span.start === start && span.end === end));
  if (exact) return exact;
  const normalized = normalizeActionLabel(raw.trim().replace(/\s+/g, " "));
  return labels.find((label) => normalizeActionLabel(label.label) === normalized) ?? null;
}

function addAtomCandidate(atoms, byKey, duration, label, source) {
  const key = `${Number(duration.seconds)}\u0000${normalizeActionLabel(label.label)}`;
  const spans = [...(duration.spans ?? []), ...(label.spans ?? [])]
    .filter(Boolean)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const existing = byKey.get(key);
  if (existing) {
    for (const span of spans) {
      if (!existing.spans.some((known) => spansEqual(known, span))) existing.spans.push(span);
    }
    if (!existing.sources.includes(source)) existing.sources.push(source);
    existing.spans.sort((left, right) => left.start - right.start || left.end - right.end);
    existing.span = existing.spans[0] ?? null;
    return existing;
  }
  const atom = {
    durationId: duration.id,
    labelId: label.id,
    seconds: Number(duration.seconds),
    value: duration.value ?? formatCompactDuration(Number(duration.seconds)),
    label: normalizeActionLabel(label.label),
    span: spans[0] ?? null,
    spans,
    source,
    sources: [source],
  };
  byKey.set(key, atom);
  atoms.push(atom);
  return atom;
}

function nearestDurationSlots(label, durations, limit, { maxDistance = 80 } = {}) {
  if (!label.spans?.length) return [];
  return durations
    .map((duration) => ({
      duration,
      distance: closestSpanDistance(label.spans, duration.spans ?? []),
    }))
    .filter((entry) => Number.isFinite(entry.distance) && entry.distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance || compareCandidateLocations(left.duration, right.duration))
    .slice(0, limit)
    .map((entry) => entry.duration);
}

function closestSpanDistance(leftSpans, rightSpans) {
  let best = Number.POSITIVE_INFINITY;
  for (const left of leftSpans) {
    for (const right of rightSpans) {
      const distance = spanDistance(left, right);
      if (distance < best) best = distance;
    }
  }
  return best;
}

function spanDistance(left, right) {
  if (spansOverlap(left, right)) return 0;
  return left.end <= right.start ? right.start - left.end : left.start - right.end;
}

function isWorkoutAtomLabel(label) {
  return ["Work", "Rest", "Hard", "Easy", "High intensity", "Low intensity", "Recovery", "Recover", "Hard effort", "Easy spin"].includes(label);
}

function isEndpointAtomLabel(label) {
  return ["Warmup", "Cooldown", "Warmdown"].includes(label);
}

function hasUsefulWorkoutAtomSignal(source, label) {
  if ((label.spans?.length ?? 0) > 0) return true;
  if (label.source !== "paired-default") return false;
  return /\b(?:alternat(?:e|ing|ions?)|intervals?|middle|start with|starting with|sets?|pairs?|rounds?|cycles?)\b|work\s*\/\s*rest|rest\s*\/\s*work|work\s*-\s*rest|rest\s*-\s*work/i.test(
    source,
  );
}

function assignSlotIds(slots, prefix) {
  slots.forEach((slot, index) => {
    slot.id = `${prefix}${index}`;
  });
}

function hasImplicitWorkoutDurationCue(source) {
  return /\b(?:work|rest|rounds?|blocks?|cycles?|sets?|alterations?|alternations?|high|low|hard|easy)\b/i.test(source);
}

function collectRegex(source, regex, visit) {
  for (const match of source.matchAll(regex)) {
    visit(match, match.index, match.index + match[0].length);
  }
}

function selectNonOverlapping(candidates, { allowExactSpanOverlap = false } = {}) {
  const selected = [];
  for (const candidate of [...candidates].sort(compareCandidatePreference)) {
    const spans = candidate.spans ?? [candidate.span];
    if (
      spans.some((span) =>
        selected.some((known) => spansOverlap(span, known.span) && !(allowExactSpanOverlap && spansEqual(span, known.span))),
      )
    ) {
      continue;
    }
    selected.push(candidate);
  }
  return selected.sort(compareCandidateLocations);
}

function compareCandidatePreference(left, right) {
  const leftSpan = left.span ?? left.spans?.[0] ?? { start: 0, end: 0 };
  const rightSpan = right.span ?? right.spans?.[0] ?? { start: 0, end: 0 };
  if (leftSpan.start !== rightSpan.start) return leftSpan.start - rightSpan.start;
  const leftLength = leftSpan.end - leftSpan.start;
  const rightLength = rightSpan.end - rightSpan.start;
  return rightLength - leftLength;
}

function compareCandidateLocations(left, right) {
  const leftSpan = left.spans?.[0] ?? left.span ?? { start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER };
  const rightSpan = right.spans?.[0] ?? right.span ?? { start: Number.MAX_SAFE_INTEGER, end: Number.MAX_SAFE_INTEGER };
  if (leftSpan.start !== rightSpan.start) return leftSpan.start - rightSpan.start;
  return leftSpan.end - rightSpan.end;
}

function spansOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function spansEqual(left, right) {
  return left.start === right.start && left.end === right.end;
}

function parseNumberPhrase(value) {
  const normalized = String(value ?? "")
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  if (Object.hasOwn(SIMPLE_NUMBER_WORD_VALUES, normalized)) return SIMPLE_NUMBER_WORD_VALUES[normalized];
  const [tens, ones] = normalized.split(" ");
  if (NUMBER_WORD_TENS.includes(tens) && NUMBER_WORD_ONES.includes(ones)) {
    return SIMPLE_NUMBER_WORD_VALUES[tens] + SIMPLE_NUMBER_WORD_VALUES[ones];
  }
  return null;
}

function formatActionCommands(timers, slotter, options = {}) {
  const hint = TIMER_DSL_HINTS.get(timers);
  if (hint?.type === "withEndpoints") {
    return [
      formatAddAction(timers[0], slotter, options),
      ...formatActionHint(hint.middleHint, slotter, options),
      formatAddAction(timers[timers.length - 1], slotter, options),
    ];
  }
  if (hint) return formatActionHint(hint, slotter, options);
  return formatActionRuns(timers, slotter, options);
}

function formatActionHint(hint, slotter, options = {}) {
  if (!hint) return [];
  if (hint.type === "alt") {
    if (hint.count === 1) return [`ADD ${formatActionAtom(hint.atoms[0], slotter, options)}`];
    return [`ALT ${slotter.count(hint.count)} ${hint.atoms.map((atom) => formatActionAtom(atom, slotter, options)).join(" ")}`];
  }
  if (hint.type === "block") {
    return [`BLOCK ${slotter.count(hint.count)} ${hint.atoms.map((atom) => formatActionAtom(atom, slotter, options)).join(" ")}`];
  }
  if (hint.type === "generic") {
    return hint.groups.map(([count, seconds]) => {
      const atom = formatActionAtom(timer("Timer", seconds, "other"), slotter, options);
      return count > 1 ? `REP ${slotter.count(count)} ${atom}` : `ADD ${atom}`;
    });
  }
  return [];
}

function formatActionRuns(timers, slotter, options = {}) {
  const commands = [];
  for (let index = 0; index < timers.length; ) {
    const current = normalizeComparableTimer(timers[index]);
    let count = 1;
    while (index + count < timers.length && areSameTimer(current, timers[index + count])) {
      count += 1;
    }
    commands.push(count > 1 ? formatRepeatAction(count, current, slotter, options) : formatAddAction(current, slotter, options));
    index += count;
  }
  return commands;
}

function formatActionAtom(timer, slotter, { atomActions = false } = {}) {
  const normalized = normalizeComparableTimer(timer);
  if (atomActions) return slotter.atom(normalized);
  return `${slotter.duration(normalized.durationSeconds)} ${slotter.label(normalized.label)}`;
}

function formatAddAction(timer, slotter, options = {}) {
  return `ADD ${formatActionAtom(timer, slotter, options)}`;
}

function formatRepeatAction(count, timer, slotter, options = {}) {
  return `REP ${slotter.count(count)} ${formatActionAtom(timer, slotter, options)}`;
}

function createActionSlotMaps(slots, context) {
  if (!slots || typeof slots !== "object") throw new Error(`${context}: missing action slots`);
  const durations = new Map((slots.durations ?? []).map((slot) => [slot.id, slot]));
  const counts = new Map((slots.counts ?? []).map((slot) => [slot.id, slot]));
  const labels = new Map((slots.labels ?? []).map((slot) => [slot.id, slot]));
  const atoms = new Map((slots.atoms ?? []).map((slot) => [slot.id, slot]));
  return { durations, counts, labels, atoms };
}

function compileActionTokens(tokens, slots, context) {
  const lines = [];
  let index = 0;
  while (index < tokens.length) {
    const commandContext = `${context}: command ${lines.length + 1}`;
    const op = tokens[index]?.toUpperCase();
    if (op === "ADD") {
      const first = tokens[index + 1];
      if (isActionAtomId(first)) {
        if (!first) throw new Error(`${commandContext}: ADD requires atom`);
        lines.push(resolveActionAtom(first, slots, commandContext));
        index += 2;
      } else {
        const args = tokens.slice(index + 1, index + 3);
        if (args.length !== 2) throw new Error(`${commandContext}: ADD requires duration and label`);
        lines.push(`${resolveActionDuration(args[0], slots, commandContext)}: ${resolveActionLabel(args[1], slots, commandContext)}`);
        index += 3;
      }
      continue;
    }
    if (op === "REP") {
      const count = tokens[index + 1];
      const first = tokens[index + 2];
      if (isActionAtomId(first)) {
        if (!count || !first) throw new Error(`${commandContext}: REP requires count and atom`);
        lines.push(`${resolveActionCount(count, slots, commandContext)}x ${resolveActionAtom(first, slots, commandContext)}`);
        index += 3;
      } else {
        const args = tokens.slice(index + 1, index + 4);
        if (args.length !== 3) throw new Error(`${commandContext}: REP requires count, duration, and label`);
        lines.push(
          `${resolveActionCount(args[0], slots, commandContext)}x ${resolveActionDuration(args[1], slots, commandContext)}: ${resolveActionLabel(
            args[2],
            slots,
            commandContext,
          )}`,
        );
        index += 4;
      }
      continue;
    }
    if (op === "ALT" || op === "BLOCK") {
      const count = tokens[index + 1];
      const first = tokens[index + 2];
      const second = tokens[index + 3];
      const prefix = op === "ALT" ? `${resolveActionCount(count, slots, commandContext)}alt` : `${resolveActionCount(count, slots, commandContext)}x`;
      if (isActionAtomId(first)) {
        if (!count || !first || !second) throw new Error(`${commandContext}: ${op} requires count and two atoms`);
        lines.push(`${prefix} ${resolveActionAtom(first, slots, commandContext)} | ${resolveActionAtom(second, slots, commandContext)}`);
        index += 4;
      } else {
        const args = tokens.slice(index + 1, index + 6);
        if (args.length !== 5) throw new Error(`${commandContext}: ${op} requires count and two duration-label atoms`);
        lines.push(
          `${prefix} ${resolveActionDuration(args[1], slots, commandContext)}: ${resolveActionLabel(
            args[2],
            slots,
            commandContext,
          )} | ${resolveActionDuration(args[3], slots, commandContext)}: ${resolveActionLabel(args[4], slots, commandContext)}`,
        );
        index += 6;
      }
      continue;
    }
    throw new Error(`${commandContext}: invalid action op ${JSON.stringify(tokens[index])}`);
  }
  return lines;
}

function cleanActionToken(token) {
  return token.replace(/^[,:\[\](){}]+|[,:\[\](){}]+$/g, "");
}

function isActionAtomId(token) {
  return /^A\d+$/i.test(String(token ?? ""));
}

function resolveActionAtom(id, slots, context) {
  const slot = slots.atoms.get(id);
  if (!slot) throw new Error(`${context}: unknown atom slot ${id}`);
  return `${slot.value ?? formatCompactDuration(slot.seconds)}: ${slot.label}`;
}

function resolveActionDuration(id, slots, context) {
  const slot = slots.durations.get(id);
  if (!slot) throw new Error(`${context}: unknown duration slot ${id}`);
  return slot.value ?? formatCompactDuration(slot.seconds);
}

function resolveActionCount(id, slots, context) {
  const slot = slots.counts.get(id);
  if (!slot) throw new Error(`${context}: unknown count slot ${id}`);
  return slot.count;
}

function resolveActionLabel(id, slots, context) {
  const slot = slots.labels.get(id);
  if (!slot) throw new Error(`${context}: unknown label slot ${id}`);
  return slot.label;
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
    return [formatGenericGroupCommand(hint.groups)];
  }
  return [];
}

function formatGenericGroupCommand(groups) {
  if (groups.length === 1) {
    const [[count, seconds]] = groups;
    return formatRepeatCommand(count, timer("Timer", seconds, "other"));
  }

  return `${groups.map(formatGenericGroupTerm).join(" + ")}: Timer`;
}

function formatGenericGroupTerm([count, seconds]) {
  const duration = formatCompactDuration(seconds);
  return count > 1 ? `${count}x${duration}` : duration;
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
  const targetFormat = record.targetFormat ?? "json";
  if (targetFormat === "dsl") return parseTimerDsl(assistant.content, `${record.id}: assistant target`).timers;
  if (targetFormat === "actions") {
    return parseTimerActions(assistant.content, record.metadata?.actionSlots, `${record.id}: assistant target`).timers;
  }
  return parseTimerJson(assistant.content, `${record.id}: assistant target`).timers;
}

function buildSpecs({
  includePhase4HardData = false,
  includeUserRequestExpansion = false,
  includePhase4HResidualData = false,
  includePhase4IBrowserResidualData = false,
} = {}) {
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
  if (includePhase4HardData) addPhase4HardGenericSpecs(add);
  if (includeUserRequestExpansion) addUserRequestExpansionSpecs(add);
  if (includePhase4HResidualData) addPhase4HResidualSpecs(add);
  if (includePhase4IBrowserResidualData) addPhase4IBrowserResidualSpecs(add);

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
          `Start with ${warmupMinutes} minutes warm up, do ${count} ${noun} each containing ${duration} hard and ${duration} easy, finish with ${cooldownMinutes} minutes cool down`,
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

function addPhase4HardGenericSpecs(add) {
  addPhase4HardGenericPositionSpecs(add);
  addPhase4HardGenericTimerSpecs(add);
}

function addPhase4HardGenericPositionSpecs(add) {
  const templates = [
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `${leftDuration} timer, ${middleCount} ${middleDuration} timers, ${rightDuration} timer`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `make a ${leftDuration} timer, then ${middleCount} ${middleDuration} timers, then another ${rightDuration} timer`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `first timer is ${leftDuration}; middle is ${middleCount} ${middleDuration} timers; final timer is ${rightDuration}`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `start with ${leftDuration}, add ${middleCount} timers of ${middleDuration}, finish with ${rightDuration}`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `bookends are ${leftDuration} and ${rightDuration}; between them use ${middleCount} ${middleDuration} timers`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `outside timers are ${leftDuration} then ${rightDuration}, with ${middleCount} ${middleDuration} timers inside`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `one ${leftDuration} timer at the beginning, ${middleCount} ${middleDuration} timers in the middle, one ${rightDuration} timer at the end`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `sandwich ${middleCount} ${middleDuration} timers between a ${leftDuration} timer and a ${rightDuration} timer`,
  ];
  const symmetricCases = [
    [480, 4, 60],
    [240, 5, 30],
    [90, 6, 10],
    [120, 4, 45],
    [180, 8, 60],
    [20, 7, 5],
    [300, 5, 60],
    [45, 5, 15],
    [360, 4, 30],
    [10, 8, 5],
    [60, 5, 20],
    [30, 3, 10],
  ];
  const asymmetricCases = [
    [60, 5, 20, 90],
    [90, 4, 15, 120],
    [30, 6, 10, 45],
    [120, 3, 30, 180],
    [20, 8, 5, 40],
    [240, 5, 45, 300],
  ];

  let variant = 0;
  for (const [outerSeconds, middleCount, middleSeconds] of symmetricCases) {
    for (let offset = 0; offset < templates.length; offset += 1) {
      const template = templates[(variant + offset) % templates.length];
      addPhase4HardGenericPositionSpec(add, template, {
        split: "train",
        leftSeconds: outerSeconds,
        middleCount,
        middleSeconds,
        rightSeconds: outerSeconds,
        variant: variant + offset,
      });
    }
    variant += templates.length;
  }

  for (const [leftSeconds, middleCount, middleSeconds, rightSeconds] of asymmetricCases) {
    for (let offset = 0; offset < 4; offset += 1) {
      const template = templates[(variant + offset) % templates.length];
      addPhase4HardGenericPositionSpec(add, template, {
        split: "train",
        leftSeconds,
        middleCount,
        middleSeconds,
        rightSeconds,
        variant: variant + offset,
      });
    }
    variant += 4;
  }

  const hardValidationCases = [
    [480, 4, 60, 480],
    [240, 5, 30, 240],
    [90, 6, 10, 90],
    [120, 4, 45, 120],
    [180, 8, 60, 180],
    [20, 7, 5, 20],
    [75, 6, 15, 75],
    [150, 3, 20, 210],
    [30, 5, 10, 60],
    [360, 4, 45, 360],
  ];
  const hardValidationTemplates = [
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `first block ${leftDuration}, then ${middleCount} short timers of ${middleDuration}, and a last block of ${rightDuration}`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `I want ${leftDuration} up front, ${middleCount} ${middleDuration} timers between, ${rightDuration} at the end`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `put the ${middleCount} ${middleDuration} timers between the opening ${leftDuration} timer and closing ${rightDuration} timer`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `beginning ${leftDuration}; inside ${middleCount} timers lasting ${middleDuration}; ending ${rightDuration}`,
    ({ leftDuration, middleCount, middleDuration, rightDuration }) =>
      `one ${leftDuration} timer, followed by ${middleCount} ${middleDuration} timers, followed by one ${rightDuration} timer`,
  ];

  for (const [leftSeconds, middleCount, middleSeconds, rightSeconds] of hardValidationCases) {
    const template = hardValidationTemplates[variant % hardValidationTemplates.length];
    addPhase4HardGenericPositionSpec(add, template, {
      split: "validation",
      hardValidation: true,
      leftSeconds,
      middleCount,
      middleSeconds,
      rightSeconds,
      variant,
    });
    variant += 1;
  }
}

function addPhase4HardGenericPositionSpec(
  add,
  template,
  { split, hardValidation = false, leftSeconds, middleCount, middleSeconds, rightSeconds, variant },
) {
  add(
    "generic-position-hard",
    template({
      leftDuration: durationText(leftSeconds),
      middleCount: wordOrNumber(middleCount, variant),
      middleDuration: durationText(middleSeconds),
      rightDuration: durationText(rightSeconds),
    }),
    genericTimers([
      [1, leftSeconds],
      [middleCount, middleSeconds],
      [1, rightSeconds],
    ]),
    {
      split,
      hardValidation,
      source: "phase4-template",
      sourceCategory: "generic-position",
    },
  );
}

function addPhase4HardGenericTimerSpecs(add) {
  const sequenceTemplates = [
    ({ firstDuration, middleCount, middleDuration, lastDuration }) =>
      `timer for ${firstDuration}, then ${middleCount} timers for ${middleDuration}, then timer for ${lastDuration}`,
    ({ firstDuration, middleCount, middleDuration, lastDuration }) =>
      `${firstDuration} once, ${middleDuration} ${middleCount} times, ${lastDuration} once`,
    ({ firstDuration, middleCount, middleDuration, lastDuration }) =>
      `plain timers only: ${firstDuration}, then ${middleCount} of ${middleDuration}, then ${lastDuration}`,
    ({ firstDuration, middleCount, middleDuration, lastDuration }) =>
      `make one timer of ${firstDuration}, ${middleCount} timers of ${middleDuration}, and one timer of ${lastDuration}`,
  ];
  const groupedCases = [
    [480, 4, 60, 480],
    [300, 5, 60, 300],
    [120, 5, 45, 120],
    [90, 6, 10, 90],
    [30, 8, 5, 30],
    [60, 4, 30, 120],
  ];

  let variant = 0;
  for (const [firstSeconds, middleCount, middleSeconds, lastSeconds] of groupedCases) {
    for (const template of sequenceTemplates) {
      addPhase4HardGenericTimerSpec(add, template, {
        split: "train",
        firstSeconds,
        middleCount,
        middleSeconds,
        lastSeconds,
        variant,
      });
      variant += 1;
    }
  }

  const singleGroupTemplates = [
    ({ count, duration }) => `exactly ${count} standalone timers of ${duration}; do not make pairs`,
    ({ count, duration }) => `only ${count} plain timers, every one lasts ${duration}`,
    ({ count, duration }) => `${count} separate ${duration} timers, no warmup, no cooldown`,
  ];
  for (const count of [7, 8, 9, 11, 12]) {
    for (const seconds of [5, 10, 20, 40, 75]) {
      const template = singleGroupTemplates[variant % singleGroupTemplates.length];
      add(
        "generic-timers-hard",
        template({ count: wordOrNumber(count, variant), duration: durationText(seconds) }),
        genericTimers([[count, seconds]]),
        {
          split: "train",
          source: "phase4-template",
          sourceCategory: "generic-timers",
        },
      );
      variant += 1;
    }
  }

  const hardValidationCases = [
    [420, 3, 45, 420],
    [180, 5, 15, 240],
    [75, 7, 20, 75],
    [8, 40],
    [11, 10],
    [9, 75],
  ];
  for (const item of hardValidationCases) {
    if (item.length === 4) {
      const [firstSeconds, middleCount, middleSeconds, lastSeconds] = item;
      const template = sequenceTemplates[variant % sequenceTemplates.length];
      addPhase4HardGenericTimerSpec(add, template, {
        split: "validation",
        hardValidation: true,
        firstSeconds,
        middleCount,
        middleSeconds,
        lastSeconds,
        variant,
      });
    } else {
      const [count, seconds] = item;
      const template = singleGroupTemplates[variant % singleGroupTemplates.length];
      add(
        "generic-timers-hard",
        template({ count: wordOrNumber(count, variant), duration: durationText(seconds) }),
        genericTimers([[count, seconds]]),
        {
          split: "validation",
          hardValidation: true,
          source: "phase4-template",
          sourceCategory: "generic-timers",
        },
      );
    }
    variant += 1;
  }
}

function addPhase4HardGenericTimerSpec(
  add,
  template,
  { split, hardValidation = false, firstSeconds, middleCount, middleSeconds, lastSeconds, variant },
) {
  add(
    "generic-timers-hard",
    template({
      firstDuration: durationText(firstSeconds),
      middleCount: wordOrNumber(middleCount, variant),
      middleDuration: durationText(middleSeconds),
      lastDuration: durationText(lastSeconds),
    }),
    genericTimers([
      [1, firstSeconds],
      [middleCount, middleSeconds],
      [1, lastSeconds],
    ]),
    {
      split,
      hardValidation,
      source: "phase4-template",
      sourceCategory: "generic-timers",
    },
  );
}

function addUserRequestExpansionSpecs(add) {
  addUserAroundContrastSpecs(add);
  addUserAroundRegressionGuardSpecs(add);
  addUserGenericSurfaceSpecs(add);
  addUserDurationSurfaceSpecs(add);
  addUserLabelSurfaceSpecs(add);
}

function addUserAroundContrastSpecs(add) {
  const endpoints = [
    [8, 8],
    [5, 5],
    [10, 8],
    [12, 9],
  ];
  const counts = [4, 5, 6, 8];
  const durations = [30, 45, 60, 90];
  const orders = [
    { order: ["rest", "work"], words: "rest/work", phrase: "rest then work" },
    { order: ["work", "rest"], words: "work/rest", phrase: "work then rest" },
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
          const duration = userDurationText(durationSeconds, variant);
          const countText = wordOrNumber(count, variant);
          const templates = [
            `${minuteText(warmupMinutes, variant)} warmup and ${minuteText(cooldownMinutes, variant + 1)} cooldown around ${countText} ${duration} ${order.words} timers`,
            `bookend ${countText} ${duration} alternating intervals with ${warmupMinutes} min warmup and ${cooldownMinutes} min cooldown, ${order.phrase}`,
            `put ${countText} ${duration} ${order.words} timers between a ${warmupMinutes} minute warmup and ${cooldownMinutes} minute cooldown`,
            `start with warmup ${warmupMinutes} minutes, surround the ${countText} middle ${duration} intervals with cooldown ${cooldownMinutes} minutes, alternate ${order.phrase}`,
            `not plain timers: ${warmupMinutes} min warmup, ${countText} ${duration} work/rest intervals in the middle, ${cooldownMinutes} min cooldown`,
          ];
          addUserExpansionSpec(add, "user-around-contrast", templates[variant % templates.length], timers, variant);
          variant += 1;
        }
      }
    }
  }

  const pairCases = [
    [8, 8, 4, 30, 15, ["work", "rest"]],
    [5, 5, 6, 45, 15, ["rest", "work"]],
    [10, 8, 5, 60, 30, ["work", "rest"]],
    [12, 9, 3, 90, 30, ["rest", "work"]],
    [6, 6, 8, 20, 10, ["work", "rest"]],
    [4, 4, 10, 30, 15, ["rest", "work"]],
  ];
  const pairTemplates = [
    ({ warmup, cooldown, count, work, rest, first, second }) =>
      `warmup ${warmup} minutes and cooldown ${cooldown} minutes around ${count} rounds, each round ${work} work and ${rest} rest, start with ${first}`,
    ({ warmup, cooldown, count, work, rest }) =>
      `bookend ${count} full blocks with ${warmup} min warmup and ${cooldown} min cooldown; every block has ${work} work plus ${rest} rest`,
    ({ warmup, cooldown, count, work, rest, first, second }) =>
      `${count} ${first}/${second} pairs between ${warmup} minute warmup and ${cooldown} minute cooldown, ${work} work ${rest} rest`,
  ];

  for (const [warmupMinutes, cooldownMinutes, count, workSeconds, restSeconds, order] of pairCases) {
    const first = order[0];
    const second = order[1];
    const timers = withEndpoints(
      warmupMinutes,
      cooldownMinutes,
      pairs(count, order, workSeconds, restSeconds, workRestLabels()),
    );
    const template = pairTemplates[variant % pairTemplates.length];
    addUserExpansionSpec(
      add,
      "user-around-contrast",
      template({
        warmup: warmupMinutes,
        cooldown: cooldownMinutes,
        count: wordOrNumber(count, variant),
        work: userDurationText(workSeconds, variant),
        rest: userDurationText(restSeconds, variant + 1),
        first,
        second,
      }),
      timers,
      variant,
    );
    variant += 1;
  }
}

function addUserAroundRegressionGuardSpecs(add) {
  const actualFailureCases = [
    {
      request:
        "12 minute warmup and 9 minute cooldown around 5 alternating 45 second rest/work intervals in the middle",
      timers: withEndpoints(12, 9, alternating(5, ["rest", "work"], 45, workRestLabels())),
    },
    {
      request:
        "8 min warmup, 8 rounds around the middle, each round has 15 seconds rest then 1 minute work, 8 min cooldown",
      timers: withEndpoints(8, 8, pairs(8, ["rest", "work"], 60, 15, workRestLabels())),
    },
    {
      request:
        "5 minute warmup, 4 rest/work intervals of 30 seconds surrounded by a 5 minute cooldown",
      timers: withEndpoints(5, 5, alternating(4, ["rest", "work"], 30, workRestLabels())),
    },
    {
      request:
        "5 minute warmup around 4 full rounds of 1 minute rest and 1 minute work, then 5 minute cooldown",
      timers: withEndpoints(5, 5, pairs(4, ["rest", "work"], 60, 60, workRestLabels())),
    },
    {
      request:
        "8 minute warmup around 6 one minute work/rest alterations, then 8 minute cooldown",
      timers: withEndpoints(8, 8, alternating(6, ["work", "rest"], 60, workRestLabels())),
    },
    {
      request:
        "10 minute warmup, surround 5 work/rest blocks with cooldown 8 minutes; every block is 1 minute work and 30 seconds rest",
      timers: withEndpoints(10, 8, pairs(5, ["work", "rest"], 60, 30, workRestLabels())),
    },
  ];

  let variant = 0;
  for (const spec of actualFailureCases) {
    addUserExpansionSpec(add, "user-around-regression-guard", spec.request, spec.timers, variant, {
      source: "phase4e-actual-around-failure",
    });
    variant += 1;
  }

  const endpoints = [
    [5, 5],
    [8, 8],
    [10, 8],
    [12, 9],
  ];
  const alternatingCases = [
    [4, 30],
    [5, 45],
    [6, 60],
    [8, 30],
    [10, 60],
  ];
  const pairCases = [
    [3, 60, 30],
    [4, 45, 15],
    [5, 60, 60],
    [6, 30, 15],
    [8, 20, 10],
  ];
  const orders = [
    { order: ["rest", "work"], words: "rest/work", phrase: "rest then work" },
    { order: ["work", "rest"], words: "work/rest", phrase: "work then rest" },
  ];

  for (const [warmupMinutes, cooldownMinutes] of endpoints) {
    for (const [count, durationSeconds] of alternatingCases) {
      for (const order of orders) {
        const timers = withEndpoints(
          warmupMinutes,
          cooldownMinutes,
          alternating(count, order.order, durationSeconds, workRestLabels()),
        );
        const duration = userDurationText(durationSeconds, variant);
        const countText = wordOrNumber(count, variant);
        const templates = [
          `${minuteText(warmupMinutes, variant)} warmup around ${countText} ${duration} alternating ${order.words} timers, then ${minuteText(cooldownMinutes, variant + 1)} cooldown`,
          `surround ${countText} ${duration} ${order.words} intervals with ${warmupMinutes} min warmup and ${cooldownMinutes} min cooldown`,
          `bookend ${countText} separate ${duration} ${order.words} middle timers with warmup ${warmupMinutes} minutes and cooldown ${cooldownMinutes} minutes`,
          `${warmupMinutes} min warmup, ${countText} ${duration} middle alterations ${order.phrase}, ${cooldownMinutes} min cooldown; not plain Timer labels`,
        ];
        addUserExpansionSpec(
          add,
          "user-around-regression-guard",
          templates[variant % templates.length],
          timers,
          variant,
          { source: "phase4e-anti-around-template" },
        );
        variant += 1;
      }
    }
  }

  for (const [warmupMinutes, cooldownMinutes] of endpoints) {
    for (const [count, workSeconds, restSeconds] of pairCases) {
      for (const order of orders) {
        const timers = withEndpoints(
          warmupMinutes,
          cooldownMinutes,
          pairs(count, order.order, workSeconds, restSeconds, workRestLabels()),
        );
        const countText = wordOrNumber(count, variant);
        const workDuration = userDurationText(workSeconds, variant);
        const restDuration = userDurationText(restSeconds, variant + 1);
        const firstKind = order.order[0];
        const secondKind = order.order[1];
        const firstDuration = firstKind === "work" ? workDuration : restDuration;
        const secondDuration = secondKind === "work" ? workDuration : restDuration;
        const templates = [
          `${warmupMinutes} minute warmup around ${countText} full ${order.words} rounds, each ${firstDuration} ${firstKind} then ${secondDuration} ${secondKind}, ${cooldownMinutes} minute cooldown`,
          `bookend ${countText} blocks with ${warmupMinutes} min warmup and ${cooldownMinutes} min cooldown; every block has ${workDuration} work and ${restDuration} rest`,
          `surround ${countText} ${order.words} pairs with warmup ${warmupMinutes} minutes and cooldown ${cooldownMinutes} minutes, work is ${workDuration}, rest is ${restDuration}`,
          `${warmupMinutes} min warmup, ${countText} complete rounds of ${firstKind} then ${secondKind} around the middle, ${cooldownMinutes} min cooldown`,
        ];
        addUserExpansionSpec(
          add,
          "user-around-regression-guard",
          templates[variant % templates.length],
          timers,
          variant,
          { source: "phase4e-anti-around-template" },
        );
        variant += 1;
      }
    }
  }
}

function addUserGenericSurfaceSpecs(add) {
  const cases = [
    [300, 5, 60, 300],
    [480, 4, 60, 480],
    [240, 5, 30, 240],
    [90, 6, 10, 90],
    [20, 7, 5, 20],
    [75, 6, 15, 75],
    [30, 5, 10, 60],
    [150, 3, 20, 210],
    [420, 3, 45, 420],
    [180, 5, 15, 240],
  ];
  const templates = [
    ({ left, middleCount, middle, right }) =>
      `plain timers only: ${left}, then ${middleCount} timers of ${middle}, then ${right}`,
    ({ left, middleCount, middle, right }) =>
      `no labels, no warmup: start with ${left}, do ${middleCount} ${middle} timers, finish with ${right}`,
    ({ left, middleCount, middle, right }) =>
      `make the outside generic timers ${left} and ${right}; put ${middleCount} ${middle} timers inside`,
    ({ left, middleCount, middle, right }) =>
      `${left} once, ${middle} ${middleCount} times, ${right} once, all plain timers`,
    ({ left, middleCount, middle, right }) =>
      `timer sequence for practice: one ${left}, ${middleCount} short ${middle} timers, one ${right}`,
  ];

  let variant = 0;
  for (const [leftSeconds, middleCount, middleSeconds, rightSeconds] of cases) {
    for (let offset = 0; offset < templates.length; offset += 1) {
      const template = templates[(variant + offset) % templates.length];
      addUserExpansionSpec(
        add,
        "user-generic-surface",
        template({
          left: userDurationText(leftSeconds, variant + offset),
          middleCount: wordOrNumber(middleCount, variant + offset),
          middle: userDurationText(middleSeconds, variant + offset + 1),
          right: userDurationText(rightSeconds, variant + offset + 2),
        }),
        genericTimers([
          [1, leftSeconds],
          [middleCount, middleSeconds],
          [1, rightSeconds],
        ]),
        variant + offset,
      );
    }
    variant += templates.length;
  }
}

function addUserDurationSurfaceSpecs(add) {
  const durationCases = [
    ["half a minute", 30],
    ["a half minute", 30],
    ["forty five seconds", 45],
    ["0:45", 45],
    ["seventy five seconds", 75],
    ["1 min 15 sec", 75],
    ["one and a half minutes", 90],
    ["ninety seconds", 90],
    ["two and a half minutes", 150],
    ["150 seconds", 150],
  ];
  const counts = [3, 4, 5, 6];

  let variant = 0;
  for (const [phrase, seconds] of durationCases) {
    const count = counts[variant % counts.length];
    const countText = wordOrNumber(count, variant);
    const templates = [
      `${countText} timers, ${phrase} each`,
      `make ${countText} plain intervals lasting ${phrase}`,
      `only ${countText} timers; every one is ${phrase}`,
      `I need ${countText} standalone ${phrase} timers`,
    ];
    addUserExpansionSpec(
      add,
      "user-duration-surface",
      templates[variant % templates.length],
      genericTimers([[count, seconds]]),
      variant,
    );
    variant += 1;
  }

  const mixedCases = [
    ["one and a half minutes", 90, "thirty seconds", 30],
    ["0:45", 45, "two minutes", 120],
    ["75 sec", 75, "15 sec", 15],
    ["2 min 30 sec", 150, "20 seconds", 20],
  ];
  for (const [firstPhrase, firstSeconds, secondPhrase, secondSeconds] of mixedCases) {
    const timers = [
      timer("Prep", firstSeconds, "other"),
      timer("Rest", secondSeconds, "rest"),
      timer("Work", firstSeconds, "work"),
    ];
    const templates = [
      `prep for ${firstPhrase}, rest ${secondPhrase}, then work for ${firstPhrase}`,
      `sequence: ${firstPhrase} prep, ${secondPhrase} rest, ${firstPhrase} work`,
    ];
    addUserExpansionSpec(add, "user-duration-surface", templates[variant % templates.length], timers, variant);
    variant += 1;
  }
}

function addUserLabelSurfaceSpecs(add) {
  const cases = [
    [
      ["Breathing reset", 30, "other"],
      ["Dead bug", 45, "other"],
      ["Recovery", 30, "rest"],
      ["Side plank", 45, "other"],
    ],
    [
      ["Jump rope", 60, "other"],
      ["Rest", 20, "rest"],
      ["Shadow boxing", 60, "other"],
      ["Rest", 20, "rest"],
    ],
    [
      ["Prep", 90, "other"],
      ["Hard effort", 30, "work"],
      ["Easy spin", 45, "rest"],
      ["Warmdown", 120, "cooldown"],
    ],
    [
      ["Round A", 40, "other"],
      ["Round B", 40, "other"],
      ["Shake out", 20, "other"],
      ["Recover", 30, "rest"],
    ],
  ];
  const templates = [
    (parts) => `set these named timers: ${parts.join(", ")}`,
    (parts) => `use exact labels and order: ${parts.join("; ")}`,
    (parts) => `create this sequence only: ${parts.join(" / ")}`,
    (parts) => `named workout timers, no defaults: ${parts.join(", then ")}`,
  ];

  let variant = 0;
  for (const item of cases) {
    for (let rotation = 0; rotation < templates.length; rotation += 1) {
      const timers = item.map(([label, seconds, kind]) => timer(label, seconds, kind));
      const parts = timers.map((entry, index) => explicitSequencePart(entry, variant + rotation + index));
      addUserExpansionSpec(
        add,
        "user-label-surface",
        templates[(variant + rotation) % templates.length](parts),
        timers,
        variant + rotation,
      );
    }
    variant += templates.length;
  }
}

function addPhase4HResidualSpecs(add) {
  addPhase4HGenericEndpointResidualSpecs(add);
  addPhase4HCountDurationResidualSpecs(add);
  addPhase4HWorkRestContrastResidualSpecs(add);
  addPhase4HPlusWorkRestGuardSpecs(add);
  addPhase4HLabelResidualSpecs(add);
}

function addPhase4HGenericEndpointResidualSpecs(add) {
  const cases = [
    [480, 4, 60, 480],
    [240, 5, 30, 240],
    [90, 6, 10, 90],
    [120, 4, 45, 120],
    [180, 8, 60, 180],
    [20, 7, 5, 20],
    [150, 3, 20, 210],
    [360, 4, 45, 360],
    [420, 3, 45, 420],
    [75, 7, 20, 75],
    [75, 6, 15, 75],
    [300, 5, 60, 300],
    [30, 5, 10, 60],
    [180, 5, 15, 240],
  ];
  const templates = [
    ({ left, middleCount, middle, right }) =>
      `plain timers: keep the opening ${left}, then exactly ${middleCount} timers of ${middle}, then keep the closing ${right}`,
    ({ left, middleCount, middle, right }) =>
      `do not drop either endpoint: ${left} first, ${middleCount} ${middle} timers in the middle, ${right} last`,
    ({ left, middleCount, middle, right }) =>
      `copy the outside durations exactly, ${left} before and ${right} after ${middleCount} short ${middle} timers`,
    ({ left, middleCount, middle, right }) =>
      `generic sequence only, no warmup labels: one ${left}, ${middleCount} of ${middle}, one ${right}`,
    ({ left, middleCount, middle, right }) =>
      `first and last are plain timers ${left} and ${right}; insert ${middleCount} ${middle} timers between them`,
    ({ left, middleCount, middle, right }) =>
      `outside timer ${left}, middle run ${middleCount} timers lasting ${middle}, outside timer ${right}`,
    ({ left, middleCount, middle, right }) =>
      `make sure there are two bookend timers: ${left} at start and ${right} at end, with ${middleCount} ${middle} timers inside`,
    ({ left, middleCount, middle, right }) =>
      `the middle count is ${middleCount}; it sits between a ${left} timer and a ${right} timer`,
  ];

  let variant = 0;
  for (const [leftSeconds, middleCount, middleSeconds, rightSeconds] of cases) {
    for (const template of templates) {
      add(
        "phase4h-generic-endpoint",
        template({
          left: userDurationText(leftSeconds, variant),
          middleCount: wordOrNumber(middleCount, variant),
          middle: userDurationText(middleSeconds, variant + 1),
          right: userDurationText(rightSeconds, variant + 2),
        }),
        genericTimers([
          [1, leftSeconds],
          [middleCount, middleSeconds],
          [1, rightSeconds],
        ]),
        {
          split: "train",
          source: "phase4h-residual",
          sourceCategory: "generic-endpoint-copy",
        },
      );
      variant += 1;
    }
  }
}

function addPhase4HCountDurationResidualSpecs(add) {
  const countCases = [
    [3, 30],
    [4, 30],
    [6, 90],
    [7, 90],
    [9, 30],
    [6, 10],
    [8, 5],
    [11, 75],
  ];
  const templates = [
    ({ count, duration }) => `exactly ${count} plain timers, each one is ${duration}; no extras`,
    ({ count, duration }) => `standalone timer list: ${count} copies of ${duration}`,
    ({ count, duration }) => `only ${count} timers total, every timer lasts ${duration}`,
    ({ count, duration }) => `repeat the same ${duration} timer ${count} times`,
    ({ count, duration }) => `${count} separate generic timers of ${duration}, not bookends`,
  ];

  let variant = 0;
  for (const [count, seconds] of countCases) {
    for (const template of templates) {
      add(
        "phase4h-count-duration",
        template({
          count: wordOrNumber(count, variant),
          duration: userDurationText(seconds, variant),
        }),
        genericTimers([[count, seconds]]),
        {
          split: "train",
          source: "phase4h-residual",
          sourceCategory: "count-duration-copy",
        },
      );
      variant += 1;
    }
  }

  const wordDurationCases = [
    [3, "half a minute", 30],
    [4, "half a minute", 30],
    [5, "a half minute", 30],
    [6, "ninety seconds", 90],
    [7, "ninety seconds", 90],
    [8, "one minute thirty seconds", 90],
  ];
  const wordDurationTemplates = [
    ({ count, duration }) => `${count} timers, ${duration} each`,
    ({ count, duration }) => `I need ${count} standalone ${duration} timers`,
    ({ count, duration }) => `make exactly ${count} plain intervals of ${duration}`,
    ({ count, duration }) => `only ${count} generic timers; each lasts ${duration}`,
  ];

  for (const [count, phrase, seconds] of wordDurationCases) {
    for (const template of wordDurationTemplates) {
      add(
        "phase4h-count-duration",
        template({ count: wordOrNumber(count, variant), duration: phrase }),
        genericTimers([[count, seconds]]),
        {
          split: "train",
          source: "phase4h-residual",
          sourceCategory: "word-duration-copy",
        },
      );
      variant += 1;
    }
  }
}

function addPhase4HWorkRestContrastResidualSpecs(add) {
  const alternatingCases = [
    [5, 5, 6, 30, ["work", "rest"]],
    [10, 8, 6, 60, ["rest", "work"]],
    [12, 9, 6, 30, ["rest", "work"]],
    [12, 9, 6, 90, ["work", "rest"]],
    [5, 5, 4, 30, ["work", "rest"]],
    [8, 8, 6, 60, ["work", "rest"]],
    [8, 8, 8, 30, ["rest", "work"]],
  ];
  const alternatingTemplates = [
    ({ warmup, cooldown, count, duration, first, second }) =>
      `${warmup} warmup and ${cooldown} cooldown around ${count} alternating ${duration} ${first}/${second} timers; keep work and rest labels`,
    ({ warmup, cooldown, count, duration, first, second }) =>
      `not plain timers: ${warmup} warmup, ${count} ${duration} alterations ${first} then ${second}, ${cooldown} cooldown`,
    ({ warmup, cooldown, count, duration, first, second }) =>
      `bookend ${count} separate ${duration} ${first}/${second} intervals with ${warmup} warmup and ${cooldown} cooldown`,
    ({ warmup, cooldown, count, duration, first, second }) =>
      `between the warmup ${warmup} and cooldown ${cooldown}, make ${count} ${duration} timers alternating ${first} then ${second}`,
    ({ warmup, cooldown, count, duration, first, second }) =>
      `do not use Timer labels: ${warmup} warmup, ${count} middle ${duration} intervals ${first}/${second}, ${cooldown} cooldown`,
  ];

  let variant = 0;
  for (const [warmupMinutes, cooldownMinutes, count, seconds, order] of alternatingCases) {
    for (const template of alternatingTemplates) {
      const timers = withEndpoints(
        warmupMinutes,
        cooldownMinutes,
        alternating(count, order, seconds, workRestLabels()),
      );
      add(
        "phase4h-work-rest-contrast",
        template({
          warmup: minuteText(warmupMinutes, variant),
          cooldown: minuteText(cooldownMinutes, variant + 1),
          count: wordOrNumber(count, variant),
          duration: userDurationText(seconds, variant),
          first: order[0],
          second: order[1],
        }),
        timers,
        {
          split: "train",
          source: "phase4h-residual",
          sourceCategory: "around-work-rest-contrast",
        },
      );
      variant += 1;
    }
  }

  const pairCases = [
    [4, 4, 10, 30, 15, ["rest", "work"]],
    [5, 5, 4, 45, 15, ["work", "rest"]],
    [8, 8, 6, 30, 15, ["work", "rest"]],
    [8, 8, 6, 60, 60, ["work", "rest"]],
    [12, 9, 3, 90, 30, ["rest", "work"]],
  ];
  const pairTemplates = [
    ({ warmup, cooldown, count, work, rest, first, second }) =>
      `${warmup} warmup around ${count} full ${first}/${second} rounds, work ${work}, rest ${rest}, then ${cooldown} cooldown`,
    ({ warmup, cooldown, count, work, rest, first, second }) =>
      `bookend ${count} complete rounds with ${warmup} warmup and ${cooldown} cooldown; each round is ${first} then ${second}`,
    ({ warmup, cooldown, count, work, rest }) =>
      `not alternating singles: ${warmup} warmup, ${count} blocks each ${work} work and ${rest} rest, ${cooldown} cooldown`,
    ({ warmup, cooldown, count, work, rest, first, second }) =>
      `around the middle are ${count} full blocks ${first}/${second}; keep durations ${work} work and ${rest} rest`,
  ];

  for (const [warmupMinutes, cooldownMinutes, count, workSeconds, restSeconds, order] of pairCases) {
    for (const template of pairTemplates) {
      const timers = withEndpoints(
        warmupMinutes,
        cooldownMinutes,
        pairs(count, order, workSeconds, restSeconds, workRestLabels()),
      );
      add(
        "phase4h-work-rest-contrast",
        template({
          warmup: minuteText(warmupMinutes, variant),
          cooldown: minuteText(cooldownMinutes, variant + 1),
          count: wordOrNumber(count, variant),
          work: userDurationText(workSeconds, variant),
          rest: userDurationText(restSeconds, variant + 1),
          first: order[0],
          second: order[1],
        }),
        timers,
        {
          split: "train",
          source: "phase4h-residual",
          sourceCategory: "around-work-rest-contrast",
        },
      );
      variant += 1;
    }
  }
}

function addPhase4HPlusWorkRestGuardSpecs(add) {
  const alternatingCases = [
    [12, 9, 5, 45, ["rest", "work"]],
    [5, 5, 10, 60, ["rest", "work"]],
    [8, 8, 6, 60, ["work", "rest"]],
    [10, 8, 5, 45, ["rest", "work"]],
    [12, 9, 8, 30, ["rest", "work"]],
  ];
  const alternatingTemplates = [
    ({ warmup, cooldown, count, duration, first, second }) =>
      `separate endpoints, no plus group: ${warmup} warmup, ${count} ${duration} alternating ${first}/${second}, ${cooldown} cooldown`,
    ({ warmup, cooldown, count, duration, first, second }) =>
      `because the middle is ${first}/${second}, write warmup and cooldown as their own timers: ${warmup}, ${count} ${duration} middle intervals, ${cooldown}`,
    ({ warmup, cooldown, count, duration, first, second }) =>
      `not generic plus syntax: ${warmup} warmup around ${count} ${duration} ${first}/${second} timers, then ${cooldown} cooldown`,
    ({ warmup, cooldown, count, duration, first, second }) =>
      `do not use Timer grouping for work/rest: ${warmup} warmup, ${count} ${duration} ${first} then ${second} alterations, ${cooldown} cooldown`,
  ];

  let variant = 0;
  for (const [warmupMinutes, cooldownMinutes, count, seconds, order] of alternatingCases) {
    for (const template of alternatingTemplates) {
      add(
        "phase4h-plus-work-rest-guard",
        template({
          warmup: minuteText(warmupMinutes, variant),
          cooldown: minuteText(cooldownMinutes, variant + 1),
          count: wordOrNumber(count, variant),
          duration: userDurationText(seconds, variant),
          first: order[0],
          second: order[1],
        }),
        withEndpoints(warmupMinutes, cooldownMinutes, alternating(count, order, seconds, workRestLabels())),
        {
          split: "train",
          source: "phase4h-residual",
          sourceCategory: "plus-work-rest-semantic-guard",
        },
      );
      variant += 1;
    }
  }

  const pairCases = [
    [5, 5, 4, 45, 15, ["work", "rest"]],
    [8, 8, 6, 30, 15, ["work", "rest"]],
    [8, 8, 3, 60, 30, ["rest", "work"]],
    [12, 9, 3, 60, 30, ["work", "rest"]],
  ];
  const pairTemplates = [
    ({ warmup, cooldown, count, work, rest, first, second }) =>
      `work/rest blocks are not plus groups: ${warmup} warmup, ${count} blocks ${first} then ${second}, ${cooldown} cooldown`,
    ({ warmup, cooldown, count, work, rest }) =>
      `keep endpoints separate from the blocks: ${warmup} warmup, ${count} rounds with ${work} work and ${rest} rest, ${cooldown} cooldown`,
    ({ warmup, cooldown, count, work, rest, first, second }) =>
      `no Timer group here: ${warmup} warmup around ${count} full ${first}/${second} rounds, work ${work}, rest ${rest}, ${cooldown} cooldown`,
  ];

  for (const [warmupMinutes, cooldownMinutes, count, workSeconds, restSeconds, order] of pairCases) {
    for (const template of pairTemplates) {
      add(
        "phase4h-plus-work-rest-guard",
        template({
          warmup: minuteText(warmupMinutes, variant),
          cooldown: minuteText(cooldownMinutes, variant + 1),
          count: wordOrNumber(count, variant),
          work: userDurationText(workSeconds, variant),
          rest: userDurationText(restSeconds, variant + 1),
          first: order[0],
          second: order[1],
        }),
        withEndpoints(warmupMinutes, cooldownMinutes, pairs(count, order, workSeconds, restSeconds, workRestLabels())),
        {
          split: "train",
          source: "phase4h-residual",
          sourceCategory: "plus-work-rest-semantic-guard",
        },
      );
      variant += 1;
    }
  }
}

function addPhase4HLabelResidualSpecs(add) {
  const cases = [
    [
      ["Breathing reset", 30, "other"],
      ["Dead bug", 45, "other"],
      ["Recovery", 30, "rest"],
      ["Side plank", 45, "other"],
    ],
    [
      ["Jump rope", 60, "other"],
      ["Rest", 20, "rest"],
      ["Shadow boxing", 60, "other"],
      ["Rest", 20, "rest"],
    ],
    [
      ["Prep", 90, "other"],
      ["Hard effort", 30, "work"],
      ["Easy spin", 45, "rest"],
      ["Warmdown", 120, "cooldown"],
    ],
  ];
  const templates = [
    (parts) => `copy every named timer and do not skip any: ${parts.join(", ")}`,
    (parts) => `exact label order matters: ${parts.join("; ")}`,
    (parts) => `named sequence only, no substitutions: ${parts.join(" / ")}`,
    (parts) => `preserve repeated labels too: ${parts.join(", then ")}`,
  ];

  let variant = 0;
  for (const item of cases) {
    const timers = item.map(([label, seconds, kind]) => timer(label, seconds, kind));
    for (const template of templates) {
      const parts = timers.map((entry, index) => explicitSequencePart(entry, variant + index));
      add("phase4h-label-copy", template(parts), timers, {
        split: "train",
        source: "phase4h-residual",
        sourceCategory: "label-copy-residual",
      });
      variant += 1;
    }
  }
}

function addPhase4IBrowserResidualSpecs(add) {
  const cases = [
    {
      request: "2 two minute timers and 3 thirty second timers",
      groups: [
        [2, 120],
        [3, 30],
      ],
      sourceCategory: "browser-raw-count-duration",
    },
    {
      request: "Make 1 timer for 90 seconds and 4 timers for 15 seconds",
      groups: [
        [1, 90],
        [4, 15],
      ],
      sourceCategory: "browser-raw-count-duration",
    },
    {
      request: "one 5 minute timer, one 1 minute timer, one 30 second timer",
      groups: [
        [1, 300],
        [1, 60],
        [1, 30],
      ],
      sourceCategory: "browser-raw-count-duration",
    },
    {
      request: "2 thirty second timers then 3 ten second timers",
      groups: [
        [2, 30],
        [3, 10],
      ],
      sourceCategory: "browser-raw-count-duration",
    },
    {
      request: "first and last timer 5minute, 5 one minute timers in between",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "start and end with 5 minute timers, 5 one-minute timers in the middle",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "put five one minute timers between two 5 minute timers",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "two 5 minute timers with 5 one minute timers in between",
      groups: [
        [1, 300],
        [5, 60],
        [1, 300],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "2 minute first and last timers, 8 thirty second timers between",
      groups: [
        [1, 120],
        [8, 30],
        [1, 120],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "first and final timers should be 90 seconds, put 4 twenty second timers between them",
      groups: [
        [1, 90],
        [4, 20],
        [1, 90],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "begin and finish with 3 minute timers, with 6 45 second timers in between",
      groups: [
        [1, 180],
        [6, 45],
        [1, 180],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "outside timers are 4 minutes each, middle is 7 one minute timers",
      groups: [
        [1, 240],
        [7, 60],
        [1, 240],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "first timer 30 seconds, last timer 30 seconds, and three 10 second timers in between",
      groups: [
        [1, 30],
        [3, 10],
        [1, 30],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "start with 45 seconds, end with 45 seconds, put 5 fifteen second timers between",
      groups: [
        [1, 45],
        [5, 15],
        [1, 45],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "make the first and last timers 2 minutes, and add 10 twenty second timers between them",
      groups: [
        [1, 120],
        [10, 20],
        [1, 120],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "10 second first and last timers with 8 five second timers in between",
      groups: [
        [1, 10],
        [8, 5],
        [1, 10],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "3 minutes at the beginning and end, with four 45 second timers inside",
      groups: [
        [1, 180],
        [4, 45],
        [1, 180],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "outer timers 90 seconds, inside 6 ten second timers",
      groups: [
        [1, 90],
        [6, 10],
        [1, 90],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
    {
      request: "two 3 minute timers around 8 one minute timers",
      groups: [
        [1, 180],
        [8, 60],
        [1, 180],
      ],
      sourceCategory: "browser-raw-generic-position",
    },
  ];
  const templates = [
    ({ request }) => request,
    ({ request }) => `copy the generic timer sequence exactly: ${request}`,
    ({ request }) => `do not add extra timers and do not change durations: ${request}`,
    ({ request }) => `raw browser residual, keep all stated endpoints and middle timers: ${request}`,
  ];

  for (const spec of cases) {
    for (const template of templates) {
      add("phase4i-browser-raw-residual", template(spec), genericTimers(spec.groups), {
        split: "train",
        duplicateOk: true,
        source: "phase4i-browser-raw-residual",
        sourceCategory: spec.sourceCategory,
      });
    }
  }
}

function addUserExpansionSpec(add, category, request, timers, variant, options = {}) {
  const validation = variant % 7 === 0;
  add(category, request, timers, {
    split: validation ? "validation" : "train",
    hardValidation: validation,
    source: options.source ?? "phase6-user-request",
    sourceCategory: category,
  });
}

function userDurationText(seconds, variant = 0) {
  const special = {
    30: ["30 seconds", "half a minute", "0:30"],
    45: ["45 seconds", "forty five seconds", "0:45"],
    75: ["75 seconds", "1 min 15 sec", "one minute fifteen seconds"],
    90: ["90 seconds", "1 minute 30 seconds", "one and a half minutes"],
    150: ["150 seconds", "2 min 30 sec", "two and a half minutes"],
  };
  const options = special[seconds];
  if (options) return options[variant % options.length];
  return durationText(seconds);
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
  if (!["app", "natural", "lossless-slots", "lossless-atoms"].includes(userFormat)) {
    throw new Error(`Unknown user format "${userFormat}". Use "app", "natural", "lossless-slots", or "lossless-atoms".`);
  }
}

function assertTargetFormat(targetFormat) {
  if (!["json", "dsl", "actions"].includes(targetFormat)) {
    throw new Error(`Unknown target format "${targetFormat}". Use "json", "dsl", or "actions".`);
  }
}
