import {
  MAX_INTERVALS as TIMER_DSL_MAX_INTERVALS,
  TIMER_DSL_DURATION_UNITS,
  findTimerDslStartIndex,
  inferTimerKind,
  parseTimerDsl,
} from "./timer-dsl.js";

export const MAX_INTERVALS = TIMER_DSL_MAX_INTERVALS;

export const KIND_META = {
  warmup: { label: "Warmup", color: "#f28c28" },
  work: { label: "Work", color: "#d94f45" },
  rest: { label: "Rest", color: "#3867d6" },
  cooldown: { label: "Cooldown", color: "#2f9e44" },
  other: { label: "Other", color: "#0f8b8d" },
};

const DURATION_UNITS = TIMER_DSL_DURATION_UNITS;
const NUMBER_WORDS = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["forty five", 45],
  ["seventy five", 75],
  ["ninety", 90],
]);

export function planWithFallback(text, currentTimers = [], conversation = []) {
  const dslTimers = extractTimerDslTimers(text);
  if (dslTimers.length) {
    return { timers: dslTimers.slice(0, MAX_INTERVALS), source: "fallback" };
  }

  const normalized = normalizePrompt(text);
  const correction = isCorrection(normalized);
  const historicalPrompt = correction ? findHistoricalWorkoutPrompt(normalized, conversation) : null;
  const historicalTimers = historicalPrompt ? planWithFallback(historicalPrompt, [], []).timers : [];
  const referenceTimers = historicalTimers.length ? historicalTimers : normalizeTimerInputs(currentTimers);
  const currentWarmup = referenceTimers.find((timer) => timer.kind === "warmup");
  const currentCooldown = [...referenceTimers].reverse().find((timer) => timer.kind === "cooldown");
  const currentWork = referenceTimers.find((timer) => timer.kind === "work");
  const currentRest = referenceTimers.find((timer) => timer.kind === "rest");
  const explicitWarmup = normalized.includes("warmup") || normalized.includes("warm up");
  const explicitCooldown =
    normalized.includes("cooldown") ||
    normalized.includes("cool down") ||
    normalized.includes("warmdown") ||
    normalized.includes("warm down");
  const alternating = mentionsAlternating(normalized);
  const middleIntervalCount = extractMiddleIntervalCount(normalized);
  const unitDuration = durationNearAlternatingUnit(normalized);
  const shouldPreferUnitDuration = Boolean(middleIntervalCount && unitDuration);
  const sharedDuration =
    correction && (alternating || hasAlternatingSection(referenceTimers))
      ? firstUsefulDuration(normalized)
      : null;
  const alternatingOrder =
    getAlternatingOrder(normalized) ?? inferAlternatingOrder(referenceTimers) ?? ["work", "rest"];

  const warmupSeconds =
    durationNearLabel(normalized, ["warmup", "warm up"], 42, true) ??
    (correction ? currentWarmup?.seconds : null) ??
    null;
  const cooldownSeconds =
    durationNearLabel(normalized, ["cooldown", "cool down", "warmdown", "warm down"], 42, true) ??
    (correction ? currentCooldown?.seconds : null) ??
    null;
  const workSeconds =
    (shouldPreferUnitDuration ? unitDuration : null) ??
    durationNearLabel(normalized, ["high intensity", "intensity", "work", "hard"], 18) ??
    durationNearLabel(normalized, ["on"], 18) ??
    unitDuration ??
    sharedDuration ??
    currentWork?.seconds ??
    60;
  const restSeconds =
    (shouldPreferUnitDuration ? unitDuration : null) ??
    durationNearLabel(normalized, ["low intensity", "rest", "recovery", "easy"], 18) ??
    unitDuration ??
    sharedDuration ??
    currentRest?.seconds ??
    60;
  const explicitGenericTimers = extractExplicitGenericTimers(normalized);

  let cycles = extractCycles(normalized);
  const totalIntervals = extractTotalIntervals(normalized);
  const eachCount = extractEachCount(normalized);
  const cycleScale = correction ? getCycleScale(normalized) : null;

  if (middleIntervalCount && (mentionsWorkAndRest(normalized) || hasAlternatingSection(referenceTimers))) {
    cycles = null;
  } else if (eachCount && mentionsWorkAndRest(normalized)) {
    cycles = eachCount;
  } else if (!cycles && totalIntervals && mentionsWorkAndRest(normalized)) {
    cycles = Math.max(1, Math.floor(totalIntervals / 2));
  } else if (!cycles && cycleScale && hasAlternatingSection(referenceTimers)) {
    cycles = Math.max(1, Math.round(inferCurrentCycles(referenceTimers) * cycleScale));
  } else if (!cycles && correction && (alternating || hasAlternatingSection(referenceTimers))) {
    cycles = inferCurrentCycles(referenceTimers);
  }

  const timers = [];

  if (explicitGenericTimers.length) {
    return { timers: explicitGenericTimers.slice(0, MAX_INTERVALS), source: "fallback" };
  }

  if (warmupSeconds && (explicitWarmup || (correction && currentWarmup))) {
    timers.push(makeTimer(currentWarmup?.label || "Warmup", warmupSeconds, "warmup"));
  }

  if (middleIntervalCount && (mentionsWorkAndRest(normalized) || hasAlternatingSection(referenceTimers))) {
    for (let index = 0; index < middleIntervalCount; index += 1) {
      pushAlternatingTimer(timers, alternatingOrder[index % alternatingOrder.length], {
        currentRest,
        currentWork,
        restSeconds,
        workSeconds,
      });
    }
  } else if (cycles) {
    for (let index = 0; index < cycles; index += 1) {
      for (const kind of alternatingOrder) {
        pushAlternatingTimer(timers, kind, {
          currentRest,
          currentWork,
          restSeconds,
          workSeconds,
        });
      }
    }
  }

  if (cooldownSeconds && (explicitCooldown || (correction && currentCooldown))) {
    timers.push(makeTimer(currentCooldown?.label || "Cooldown", cooldownSeconds, "cooldown"));
  }

  if (!timers.length && referenceTimers.length && totalIntervals && mentionsWorkAndRest(normalized)) {
    const fallbackMiddleCount = middleIntervalCount ?? null;
    const fallbackCycles = fallbackMiddleCount ? null : eachCount || Math.max(1, Math.floor(totalIntervals / 2));
    if (currentWarmup) timers.push(makeTimer(currentWarmup.label, currentWarmup.seconds, "warmup"));
    if (fallbackMiddleCount) {
      for (let index = 0; index < fallbackMiddleCount; index += 1) {
        pushAlternatingTimer(timers, alternatingOrder[index % alternatingOrder.length], {
          currentRest,
          currentWork,
          restSeconds,
          workSeconds,
        });
      }
    } else {
      for (let index = 0; index < fallbackCycles; index += 1) {
        timers.push(makeTimer(currentWork?.label || "High intensity", workSeconds, "work"));
        timers.push(makeTimer(currentRest?.label || "Rest", restSeconds, "rest"));
      }
    }
    if (currentCooldown) {
      timers.push(makeTimer(currentCooldown.label, currentCooldown.seconds, "cooldown"));
    }
  }

  if (!timers.length) {
    const standaloneDuration = firstUsefulDuration(normalized);
    if (standaloneDuration) {
      timers.push(makeTimer("Interval", standaloneDuration, "other"));
    }
  }

  if (!timers.length) {
    throw new Error("I need at least one duration.");
  }

  return { timers: timers.slice(0, MAX_INTERVALS), source: "fallback" };
}

export function getWorkoutShape(timers) {
  const normalizedTimers = normalizeTimerInputs(timers);
  const totalSeconds = normalizedTimers.reduce((total, timer) => total + timer.seconds, 0);
  const middle = normalizedTimers.filter((timer) => timer.kind === "work" || timer.kind === "rest");
  const middleKinds = middle.map((timer) => timer.kind);
  const order = inferAlternatingOrder(normalizedTimers);
  const workDurations = uniqueDurations(middle.filter((timer) => timer.kind === "work"));
  const restDurations = uniqueDurations(middle.filter((timer) => timer.kind === "rest"));
  const warmup = normalizedTimers.find((timer) => timer.kind === "warmup");
  const cooldown = [...normalizedTimers].reverse().find((timer) => timer.kind === "cooldown");

  return {
    intervalCount: normalizedTimers.length,
    totalSeconds,
    warmup: warmup ? { label: warmup.label, durationSeconds: warmup.seconds } : null,
    cooldown: cooldown ? { label: cooldown.label, durationSeconds: cooldown.seconds } : null,
    middle: {
      intervalCount: middle.length,
      cycleCount: inferCurrentCycles(normalizedTimers) ?? 0,
      hasAlternatingPattern: hasAlternatingSection(normalizedTimers),
      order,
      startsWith: middleKinds[0] ?? null,
      endsWith: middleKinds[middleKinds.length - 1] ?? null,
      workDurationsSeconds: workDurations,
      restDurationsSeconds: restDurations,
    },
  };
}

export function normalizePrompt(text) {
  return replaceNumberWords(text)
    .toLowerCase()
    .replace(/[-–—]+/g, " ")
    .replaceAll(",", " ")
    .replaceAll(";", " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferKind(label) {
  return inferTimerKind(label);
}

export function isCorrection(text) {
  return (
    /(\bwrong\b|actually|instead|not\s+\d+|must have|should've|shoudl|correction|change it|fix it|wanted|meant|removed|too many|too few|twice as little|half as many|twice less|fewer|like (?:i )?described|at first|middle ones?)/.test(
      text,
    ) ||
    /\b(?:middle|current|previous|existing|sixth|6th|last one|first one|ones?|it|that|they|them)\b.{0,48}\bshould\s+(?:be|have)\b/.test(
      text,
    )
  );
}

function normalizeTimerInputs(timers) {
  if (!Array.isArray(timers)) return [];
  return timers
    .slice(0, MAX_INTERVALS)
    .map((timer) => {
      const label = String(timer.label || "Interval").trim().slice(0, 48);
      const seconds = clampInteger(timer.seconds ?? timer.durationSeconds ?? 60, 1, 86400);
      const kind = KIND_META[timer.kind] ? timer.kind : inferKind(label);
      return makeTimer(label || KIND_META[kind].label, seconds, kind);
    })
    .filter((timer) => timer.seconds > 0);
}

function makeTimer(label, seconds, kind = "work") {
  return {
    label,
    seconds: clampInteger(seconds, 1, 86400),
    kind: KIND_META[kind] ? kind : "other",
  };
}

function pushAlternatingTimer(timers, kind, { currentRest, currentWork, restSeconds, workSeconds }) {
  if (kind === "work") {
    timers.push(makeTimer(currentWork?.label || "High intensity", workSeconds, "work"));
    return;
  }
  timers.push(makeTimer(currentRest?.label || "Rest", restSeconds, "rest"));
}

function extractTimerDslTimers(text) {
  const source = String(text || "").trim();
  const start = findTimerDslStartIndex(source);
  if (start < 0) return [];

  try {
    return parseTimerDsl(source.slice(start), "timer DSL").timers.map((timer) =>
      makeTimer(timer.label, timer.durationSeconds, timer.kind),
    );
  } catch (error) {
    throw new Error(`Invalid timer DSL: ${error.message}`);
  }
}

function replaceNumberWords(text) {
  const numberWords = {
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
    "forty five": 45,
    "seventy five": 75,
    ninety: 90,
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  };
  const pattern = new RegExp(
    `\\b(${Object.keys(numberWords)
      .sort((left, right) => right.length - left.length)
      .map(escapeRegExp)
      .join("|")})\\b`,
    "gi",
  );
  return String(text).replace(
    pattern,
    (match, _word, offset, fullText) => {
      if (match.toLowerCase() === "second" && hasDurationAmountBefore(fullText, offset)) {
        return match;
      }
      return String(numberWords[match.toLowerCase()]);
    },
  );
}

function hasDurationAmountBefore(text, offset) {
  const before = text.slice(Math.max(0, offset - 24), offset).toLowerCase();
  return /(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|sixteen|twenty|thirty|forty|ninety)\s+$/.test(
    before,
  );
}

function mentionsWorkAndRest(text) {
  return mentionsRestLike(text) && mentionsWorkLike(text);
}

function mentionsAlternating(text) {
  return /\b(alternating|alterating|alternate|alternations?|alterations?|blocks?|rounds?|cycles?|steps?|sets?|middle|middle ones)\b/.test(
    text,
  );
}

function mentionsRestLike(text) {
  return /\b(rest|recovery|easy|low intensity)\b/.test(text);
}

function mentionsWorkLike(text) {
  return /\b(high intensity|work|hard)\b/.test(text) || /\bintensity\b/.test(text.replaceAll("low intensity", ""));
}

function findHistoricalWorkoutPrompt(currentText, conversation) {
  if (!Array.isArray(conversation)) return null;

  const candidates = conversation
    .filter((message) => message?.role === "user")
    .map((message) => normalizePrompt(message.text || ""))
    .filter((message) => message && message !== currentText)
    .filter((message) => !isCorrection(message))
    .filter((message) => firstUsefulDuration(message) && looksLikeWorkoutRequest(message));

  if (!candidates.length) return null;
  if (/\bfirst\b|at first|original|described/.test(currentText)) return candidates[0];
  return candidates[candidates.length - 1];
}

function looksLikeWorkoutRequest(text) {
  return (
    mentionsAlternating(text) ||
    text.includes("warmup") ||
    text.includes("warm up") ||
    text.includes("cooldown") ||
    text.includes("cool down") ||
    text.includes("warmdown") ||
    text.includes("warm down") ||
    mentionsWorkAndRest(text)
  );
}

function hasAlternatingSection(timers) {
  return timers.filter((timer) => timer.kind === "work" || timer.kind === "rest").length >= 2;
}

function getAlternatingOrder(text) {
  const restFirst = /(low intensity|rest|recovery|easy)\s*(?:\/|and|then|,)\s*(?:high intensity|intensity|work|hard)/.test(
    text,
  );
  if (restFirst) return ["rest", "work"];

  const workFirst = /(?:high intensity|intensity|work|hard)\s*(?:\/|and|then|,)\s*(low intensity|rest|recovery|easy)/.test(
    text,
  );
  if (workFirst) return ["work", "rest"];

  const restIndex = text.search(/\b(low intensity|rest|recovery|easy)\b/);
  const workIndex = text.search(/\b(high intensity|intensity|work|hard)\b/);
  if (restIndex >= 0 && workIndex >= 0) {
    return restIndex < workIndex ? ["rest", "work"] : ["work", "rest"];
  }

  return null;
}

function inferAlternatingOrder(timers) {
  const firstTwo = timers.filter((timer) => timer.kind === "work" || timer.kind === "rest").slice(0, 2);
  if (firstTwo.length < 2) return null;
  if (firstTwo[0].kind === firstTwo[1].kind) return null;
  return [firstTwo[0].kind, firstTwo[1].kind];
}

function inferCurrentCycles(timers) {
  const alternatingIntervals = timers.filter(
    (timer) => timer.kind === "work" || timer.kind === "rest",
  ).length;
  return alternatingIntervals ? Math.max(1, Math.floor(alternatingIntervals / 2)) : null;
}

function getCycleScale(text) {
  if (/(twice as little|twice less|half as many|half the|halve|too many|fewer|less)/.test(text)) {
    return 0.5;
  }
  if (/(twice as many|double)/.test(text)) {
    return 2;
  }
  return null;
}

function extractCycles(text) {
  const labeledMatch = text.match(/(\d+)\s*(?:rounds?|cycles?|blocks?|sets?|alternations?|alterations?)/);
  if (labeledMatch) return clampInteger(labeledMatch[1], 1, MAX_INTERVALS / 2);

  const genericAlternatingMatch = text.match(/(\d+)\s*(?:alternating|alterating|alternate)\b/);
  return genericAlternatingMatch ? clampInteger(genericAlternatingMatch[1], 1, MAX_INTERVALS / 2) : null;
}

export function extractExplicitGenericTimers(text) {
  if (!/\b(?:timers?|intervals?)\b/.test(text)) return [];
  if (
    mentionsGenericTimerConflict(text) ||
    mentionsRestLike(text) ||
    mentionsWorkLike(text) ||
    hasEndpointLabel(text)
  ) {
    return [];
  }

  const structuredTimers = extractStructuredGenericSequenceTimers(text);
  if (structuredTimers.length) return structuredTimers;

  const positionalTimers = extractPositionalGenericTimers(text);
  if (positionalTimers.length) return positionalTimers;

  return extractSequentialGenericTimers(text);
}

function extractStructuredGenericSequenceTimers(text) {
  const countedGroups = findCountedGenericDurationGroups(text);
  if (!countedGroups.length) return [];

  const durationSpans = extractDurationSpans(text);
  for (const group of countedGroups) {
    const before = durationSpans.filter((span) => span.end <= group.start);
    const after = durationSpans.filter((span) => span.start >= group.end);
    const endpoints = findStructuredGenericEndpoints(text, before, after);
    if (!endpoints) continue;

    return expandGenericTimerGroups([
      [1, endpoints.leftSeconds],
      [group.count, group.seconds],
      [1, endpoints.rightSeconds],
    ]);
  }

  return [];
}

function findStructuredGenericEndpoints(text, before, after) {
  if (before.length && after.length) {
    return {
      leftSeconds: before[before.length - 1].seconds,
      rightSeconds: after[0].seconds,
    };
  }

  if (
    before.length >= 2 &&
    /\b(?:outside|outer)\s+generic\s+timers?\b|\b(?:outside|outer)\s+timers?\b/.test(text)
  ) {
    return {
      leftSeconds: before[0].seconds,
      rightSeconds: before[1].seconds,
    };
  }

  return null;
}

function findCountedGenericDurationGroups(text) {
  const groups = [];
  const durationSpans = extractDurationSpans(text);

  for (const duration of durationSpans) {
    const before = text.slice(Math.max(0, duration.start - 56), duration.start);
    const after = text.slice(duration.end, Math.min(text.length, duration.end + 56));
    const beforeCount = parseTrailingCount(before);
    const timersOfCount = parseTimersOfCount(before);
    const afterTimesCount = parseLeadingTimesCount(after);

    if (timersOfCount) {
      groups.push({
        start: duration.start - before.length + timersOfCount.start,
        end: duration.end,
        count: timersOfCount.count,
        seconds: duration.seconds,
      });
      continue;
    }

    if (beforeCount && /^\s*(?:timers?|intervals?)\b/.test(after)) {
      groups.push({
        start: duration.start - beforeCount.width,
        end: duration.end + after.match(/^\s*(?:timers?|intervals?)/)[0].length,
        count: beforeCount.count,
        seconds: duration.seconds,
      });
      continue;
    }

    if (afterTimesCount) {
      groups.push({
        start: duration.start,
        end: duration.end + afterTimesCount.width,
        count: afterTimesCount.count,
        seconds: duration.seconds,
      });
    }
  }

  return dedupeCountedGroups(groups)
    .filter((group) => group.count > 1)
    .sort((left, right) => left.start - right.start);
}

function parseTrailingCount(text) {
  const match = new RegExp(`(?:^|\\s)(${numberTokenPattern()})\\s+(?:short\\s+)?$`).exec(text);
  if (!match) return null;
  const count = parseNumberToken(match[1]);
  return count ? { count: clampInteger(count, 1, MAX_INTERVALS), width: match[0].trimStart().length } : null;
}

function parseTimersOfCount(text) {
  const match = new RegExp(`(?:^|\\s)(${numberTokenPattern()})\\s+(?:plain\\s+|short\\s+)?(?:timers?|intervals?)\\s+(?:of|for)\\s+$`).exec(
    text,
  );
  if (!match) return null;
  const count = parseNumberToken(match[1]);
  if (!count) return null;
  return {
    count: clampInteger(count, 1, MAX_INTERVALS),
    start: match.index + match[0].indexOf(match[1]),
  };
}

function parseLeadingTimesCount(text) {
  const match = new RegExp(`^\\s*(${numberTokenPattern()})\\s+times\\b`).exec(text);
  if (!match) return null;
  const count = parseNumberToken(match[1]);
  return count ? { count: clampInteger(count, 1, MAX_INTERVALS), width: match[0].length } : null;
}

function dedupeCountedGroups(groups) {
  const result = [];
  for (const group of groups) {
    const duplicate = result.some(
      (existing) =>
        existing.start === group.start &&
        existing.end === group.end &&
        existing.count === group.count &&
        existing.seconds === group.seconds,
    );
    if (!duplicate) result.push(group);
  }
  return result;
}

function extractPositionalGenericTimers(text) {
  const separatedEndpointTimers = extractSeparatedEndpointGenericTimers(text);
  if (separatedEndpointTimers.length) return separatedEndpointTimers;

  const aroundTimers = extractAroundGenericTimers(text);
  if (aroundTimers.length) return aroundTimers;

  const betweenTwoTimers = extractBetweenTwoOuterGenericTimers(text);
  if (betweenTwoTimers.length) return betweenTwoTimers;

  const middleGroup = findCountedDurationGroup(text);
  if (!middleGroup) return [];

  const outerSeconds =
    findFirstLastOuterDuration(text) ??
    findLeadingFirstLastOuterDuration(text) ??
    findStartFinishOuterDuration(text) ??
    findOuterTimerDuration(text) ??
    findRepeatedEndpointDuration(text) ??
    findBookendOuterDuration(text) ??
    findBeginFinishOuterDuration(text);
  if (!outerSeconds) return [];

  return expandGenericTimerGroups([
    [1, outerSeconds],
    [middleGroup.count, middleGroup.seconds],
    [1, outerSeconds],
  ]);
}

function extractSeparatedEndpointGenericTimers(text) {
  const firstEndpoint = findEndpointDuration(
    text,
    new RegExp(
      `\\b(?:first|1)\\s*(?:timers?\\s*)?(?:is\\s+|are\\s+|should\\s+be\\s+)?${durationPattern()}`,
      "g",
    ),
  );
  if (!firstEndpoint) return [];

  const lastEndpoint = findEndpointDuration(
    text,
    new RegExp(
      `\\b(?:last|final)\\s*(?:timers?\\s*)?(?:is\\s+|are\\s+|should\\s+be\\s+)?${durationPattern()}`,
      "g",
    ),
    firstEndpoint.end,
  );
  if (!lastEndpoint || firstEndpoint.seconds !== lastEndpoint.seconds) return [];

  const middleGroup = findCountedDurationGroup(blankRanges(text, [firstEndpoint, lastEndpoint]));
  if (!middleGroup) return [];

  return expandGenericTimerGroups([
    [1, firstEndpoint.seconds],
    [middleGroup.count, middleGroup.seconds],
    [1, firstEndpoint.seconds],
  ]);
}

function extractAroundGenericTimers(text) {
  const match = new RegExp(
    `\\b2\\s+${durationPattern()}\\s+timers?\\s+(?:around|with)\\s+(${numberTokenPattern()})\\s+(${numberTokenPattern()})\\s*(${strictDurationUnitPattern()})\\s*(?:timers?|intervals?)?`,
  ).exec(text);
  if (!match) return [];

  const outerSeconds = durationFromParts(Number(match[1]), match[2]);
  const middleCount = parseNumberToken(match[3]);
  const middleSeconds = durationFromParts(parseNumberToken(match[4]), match[5]);
  if (!outerSeconds || !middleCount || !middleSeconds) return [];

  return expandGenericTimerGroups([
    [1, outerSeconds],
    [middleCount, middleSeconds],
    [1, outerSeconds],
  ]);
}

function extractBetweenTwoOuterGenericTimers(text) {
  const match = new RegExp(
    `\\b(${numberTokenPattern()})\\s+(${numberTokenPattern()})\\s*(${strictDurationUnitPattern()})\\s*(?:timers?|intervals?)?\\s+between\\s+2\\s+${durationPattern()}\\s+timers?`,
  ).exec(text);
  if (!match) return [];

  const middleCount = parseNumberToken(match[1]);
  const middleSeconds = durationFromParts(parseNumberToken(match[2]), match[3]);
  const outerSeconds = durationFromParts(Number(match[4]), match[5]);
  if (!outerSeconds || !middleCount || !middleSeconds) return [];

  return expandGenericTimerGroups([
    [1, outerSeconds],
    [middleCount, middleSeconds],
    [1, outerSeconds],
  ]);
}

function extractSequentialGenericTimers(text) {
  const groups = [];
  const genericGroupPattern = new RegExp(
    [
      `\\b(?:(?<count>${numberTokenPattern()})\\s+(?:short\\s+)?(?<durationValue>${numberTokenPattern()})\\s*(?<durationUnit>${strictDurationUnitPattern()})\\s*(?:timers?|intervals?)?`,
      `|(?<singleValue>${numberTokenPattern()})\\s*(?<singleUnit>${strictDurationUnitPattern()})\\s*(?:timers?|intervals?))\\b`,
    ].join(""),
    "g",
  );

  for (const match of text.matchAll(genericGroupPattern)) {
    const captures = match.groups ?? {};
    addGenericGroupMatch(
      captures.count ? parseNumberToken(captures.count) : 1,
      captures.durationValue ?? captures.singleValue,
      captures.durationUnit ?? captures.singleUnit,
      match.index,
    );
  }

  const countThenDurationPatterns = [
    new RegExp(
      `\\b(${numberTokenPattern()})\\s+(?:standalone\\s+|plain\\s+|separate\\s+)?(?:timers?|intervals?)\\s*(?:,?\\s*(?:each|of|for))\\s+${durationPattern()}`,
      "g",
    ),
    new RegExp(
      `\\b(${numberTokenPattern()})\\s+(?:standalone\\s+|plain\\s+|separate\\s+)?(?:timers?|intervals?)\\s*,?\\s*${durationPattern()}\\s+each\\b`,
      "g",
    ),
  ];
  for (const pattern of countThenDurationPatterns) {
    for (const match of text.matchAll(pattern)) {
      addGenericGroupMatch(parseNumberToken(match[1]), match[2], match[3], match.index);
    }
  }

  groups.sort((left, right) => left.index - right.index);
  return expandGenericTimerGroups(groups.map((group) => [group.count, group.seconds]));

  function addGenericGroupMatch(countValue, durationValueToken, durationUnit, index) {
    const durationValue = parseNumberToken(durationValueToken);
    if (!countValue || !durationValue) return;

    const seconds = durationFromParts(durationValue, durationUnit);
    if (!seconds) return;
    groups.push({ index: Number.isFinite(index) ? index : Number.MAX_SAFE_INTEGER, count: countValue, seconds });
  }
}

function findCountedDurationGroup(text) {
  const pattern = new RegExp(
    `\\b(${numberTokenPattern()})\\s+(${numberTokenPattern()})\\s*(${DURATION_UNITS})\\s*(?:timers?|intervals?)?`,
    "g",
  );
  for (const match of text.matchAll(pattern)) {
    const count = parseNumberToken(match[1]);
    const durationValue = parseNumberToken(match[2]);
    const seconds = durationFromParts(durationValue, match[3]);
    if (count && seconds) return { count: clampInteger(count, 1, MAX_INTERVALS - 2), seconds };
  }
  return null;
}

function findEndpointDuration(text, pattern, startIndex = 0) {
  pattern.lastIndex = startIndex;
  let match;
  while ((match = pattern.exec(text))) {
    const seconds = durationFromMatch(match);
    if (seconds) return { seconds, start: match.index, end: match.index + match[0].length };
  }
  return null;
}

function blankRanges(text, ranges) {
  const chars = [...String(text || "")];
  for (const range of ranges) {
    for (let index = range.start; index < range.end && index < chars.length; index += 1) {
      chars[index] = " ";
    }
  }
  return chars.join("");
}

function findFirstLastOuterDuration(text) {
  const match = new RegExp(
    `\\b(?:first|1)\\s+and\\s+(?:last|final)\\s*(?:timers?)?\\s*(?:are|is|should\\s+be)?\\s*${durationPattern()}`,
  ).exec(text);
  return match ? durationFromMatch(match) : null;
}

function findLeadingFirstLastOuterDuration(text) {
  const match = new RegExp(`${durationPattern()}\\s+(?:first|1)\\s+and\\s+(?:last|final)\\s+timers?`).exec(text);
  return match ? durationFromMatch(match) : null;
}

function findStartFinishOuterDuration(text) {
  const match = new RegExp(
    `\\b(?:start|begin)\\s+and\\s+(?:end|finish)\\s+with\\s+${durationPattern()}\\s*(?:timers?|intervals?)?`,
  ).exec(text);
  return match ? durationFromMatch(match) : null;
}

function findOuterTimerDuration(text) {
  const match = new RegExp(
    `\\b(?:outer|outside)\\s+timers?\\s*(?:are|is|should\\s+be)?\\s*${durationPattern()}`,
  ).exec(text);
  return match ? durationFromMatch(match) : null;
}

function findRepeatedEndpointDuration(text) {
  const match = new RegExp(
    `\\b(?:first|1)\\s+timer\\s*${durationPattern()}.*?\\b(?:last|final)\\s+timer\\s*${durationPattern()}`,
  ).exec(text);
  if (!match) return null;

  const firstSeconds = durationFromParts(Number(match[1]), match[2]);
  const lastSeconds = durationFromParts(Number(match[3]), match[4]);
  return firstSeconds === lastSeconds ? firstSeconds : null;
}

function findBookendOuterDuration(text) {
  const bookendMatch = new RegExp(`\\bbookend\\b.*?\\bwith\\s+${durationPattern()}\\s*(?:timers?|intervals?)?`).exec(text);
  if (bookendMatch) return durationFromMatch(bookendMatch);

  const beginningEndMatch = new RegExp(`${durationPattern()}\\s+at\\s+(?:the\\s+)?(?:beginning|start)\\s+and\\s+(?:the\\s+)?end`).exec(text);
  return beginningEndMatch ? durationFromMatch(beginningEndMatch) : null;
}

function findBeginFinishOuterDuration(text) {
  const match = new RegExp(
    `\\b(?:begin|start)\\s+with\\s+${durationPattern()}.*?\\b(?:finish|end)\\s+with\\s+${durationPattern()}`,
  ).exec(text);
  if (!match) return null;

  const firstSeconds = durationFromParts(Number(match[1]), match[2]);
  const lastSeconds = durationFromParts(Number(match[3]), match[4]);
  return firstSeconds === lastSeconds ? firstSeconds : null;
}

function expandGenericTimerGroups(groups) {
  const timers = [];
  for (const [rawCount, seconds] of groups) {
    const count = clampInteger(rawCount, 1, MAX_INTERVALS - timers.length);
    for (let index = 0; index < count && timers.length < MAX_INTERVALS; index += 1) {
      timers.push(makeTimer("Timer", seconds, "other"));
    }
  }
  return timers;
}

function mentionsGenericTimerConflict(text) {
  return /\b(alternating|alterating|alternate|alternations?|alterations?|blocks?|rounds?|cycles?|steps?|sets?)\b/.test(
    text,
  );
}

function extractTotalIntervals(text) {
  const match = text.match(/(\d+)\s*(?:timers?|intervals?)/);
  return match ? clampInteger(match[1], 1, MAX_INTERVALS) : null;
}

function extractMiddleIntervalCount(text) {
  const countDurationBeforeUnitMatch = new RegExp(
    `(?:exactly\\s+)?(\\d+)\\s+${durationPattern()}\\s+(?:steps?|intervals?|timers?)`,
  ).exec(text);
  if (countDurationBeforeUnitMatch) return clampInteger(countDurationBeforeUnitMatch[1], 1, MAX_INTERVALS);

  const directMatch = text.match(/(?:exactly\s+)?(\d+)\s*(?:steps?|intervals?|timers?)/);
  if (directMatch) return clampInteger(directMatch[1], 1, MAX_INTERVALS);

  const middleBeforeMatch = text.match(/(?:middle|between|in between)\D{0,48}?(\d+)\s*(?:steps?|intervals?|timers?)/);
  if (middleBeforeMatch) return clampInteger(middleBeforeMatch[1], 1, MAX_INTERVALS);

  const middleAfterMatch = text.match(/(\d+)\s*(?:steps?|intervals?|timers?)\D{0,48}?(?:middle|between|in between)/);
  return middleAfterMatch ? clampInteger(middleAfterMatch[1], 1, MAX_INTERVALS) : null;
}

function extractEachCount(text) {
  const match = text.match(/(\d+)\s*each/);
  return match ? clampInteger(match[1], 1, MAX_INTERVALS / 2) : null;
}

function durationNearAlternatingUnit(text) {
  const unitPattern = "(?:steps?|intervals?|timers?|blocks?|rounds?|cycles?|sets?|alternations?|alterations?)";
  const patterns = [
    new RegExp(`\\beach\\s+${unitPattern}\\s+(?:should\\s+be\\s+|is\\s+|are\\s+|lasts?\\s+|for\\s+)?${durationPattern()}`),
    new RegExp(`\\b\\d+\\s+${durationPattern()}\\s+${unitPattern}`),
    new RegExp(`\\b${unitPattern}\\s+(?:each\\s+|should\\s+be\\s+|are\\s+|of\\s+|for\\s+)?${durationPattern()}`),
    new RegExp(`${durationPattern()}\\s+per\\s+${unitPattern}`),
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const seconds = match ? durationFromMatch(match) : null;
    if (seconds) return seconds;
  }

  const eachDurationPattern = new RegExp(`\\beach\\s+${durationPattern()}`, "g");
  for (const match of text.matchAll(eachDurationPattern)) {
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    if (/(steps?|intervals?|timers?|middle|between|in between)/.test(before)) {
      return durationFromMatch(match);
    }
  }

  const durationEachPattern = new RegExp(`${durationPattern()}\\s+each`, "g");
  for (const match of text.matchAll(durationEachPattern)) {
    const before = text.slice(Math.max(0, match.index - 80), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 80);
    if (
      /(steps?|intervals?|timers?|middle|between|in between)/.test(before) ||
      /(alternating|alterating|alternate|steps?|intervals?|timers?|middle)/.test(after)
    ) {
      return durationFromMatch(match);
    }
  }

  return null;
}

function durationNearLabel(text, labels, maxDistance = 42, allowEndpointBridge = false) {
  for (const label of labels) {
    const labelPattern = new RegExp(`\\b${escapeRegExp(label)}\\b`, "g");
    let labelMatch;
    while ((labelMatch = labelPattern.exec(text))) {
      const before = text.slice(Math.max(0, labelMatch.index - 54), labelMatch.index);
      const after = text.slice(labelMatch.index + label.length, labelMatch.index + label.length + 54);
      const candidates = [];
      const afterMatch = new RegExp(durationPattern()).exec(after);
      if (afterMatch) {
        candidates.push({
          bridge: after.slice(0, afterMatch.index),
          distance: afterMatch.index,
          seconds: durationFromMatch(afterMatch),
        });
      }

      const beforeMatches = [...before.matchAll(new RegExp(durationPattern(), "g"))];
      for (const beforeMatch of beforeMatches) {
        const bridge = before.slice(beforeMatch.index + beforeMatch[0].length);
        candidates.push({
          bridge,
          distance: bridge.length,
          seconds: durationFromMatch(beforeMatch),
        });
      }

      const nearest = candidates
        .filter((candidate) => isDurationBridge(candidate.bridge, maxDistance, allowEndpointBridge))
        .sort((left, right) => left.distance - right.distance)[0];
      if (nearest) return nearest.seconds;
    }
  }
  return null;
}

function isDurationBridge(bridge, maxDistance, allowEndpointBridge = false) {
  const normalized = bridge.trim();
  if (
    allowEndpointBridge &&
    /^(?:and\s+)?(?:warmup|warm up|cooldown|cool down|warmdown|warm down)$/.test(normalized)
  ) {
    return true;
  }
  if (/\b(?:then|warmup|warmdown|cooldown|alternating|alterating|alternate)\b|\d/.test(normalized)) {
    return false;
  }
  if (normalized.length <= maxDistance) return true;
  return /^(?:cycles?|blocks?|steps?|intervals?|timers?|each|per|of|for|\/|and|\s|-)+$/.test(
    normalized,
  );
}

function hasEndpointLabel(text) {
  const withoutNegatedEndpointLabels = String(text || "").replace(
    /\bno\s+(?:warmup|warm up|cooldown|cool down|warmdown|warm down)\b/g,
    "",
  );
  return /\b(warmup|warm up|cooldown|cool down|warmdown|warm down)\b/.test(withoutNegatedEndpointLabels);
}

function firstUsefulDuration(text) {
  for (const match of text.matchAll(new RegExp(durationPattern(), "g"))) {
    const seconds = durationFromMatch(match);
    if (seconds) return seconds;
  }
  return null;
}

function extractDurationSpans(text) {
  return dedupeDurationSpans([
    ...extractClockDurationSpans(text),
    ...extractHalfMinuteDurationSpans(text),
    ...extractAndHalfDurationSpans(text),
    ...extractUnitDurationSpans(text),
  ]).sort((left, right) => left.start - right.start || right.end - left.end);
}

function extractClockDurationSpans(text) {
  const spans = [];
  for (const match of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) {
    const minutes = Number(match[1]);
    const seconds = Number(match[2]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || seconds >= 60) continue;
    spans.push({
      start: match.index,
      end: match.index + match[0].length,
      seconds: minutes * 60 + seconds,
    });
  }
  return spans.filter((span) => span.seconds > 0);
}

function extractHalfMinuteDurationSpans(text) {
  const spans = [];
  for (const match of text.matchAll(/\b(?:a\s+)?half\s+(?:a\s+)?minutes?\b/g)) {
    spans.push({ start: match.index, end: match.index + match[0].length, seconds: 30 });
  }
  return spans;
}

function extractAndHalfDurationSpans(text) {
  const spans = [];
  const pattern = new RegExp(`\\b(${numberTokenPattern()})\\s+and\\s+a\\s+half\\s+(${strictDurationUnitPattern()})`, "g");
  for (const match of text.matchAll(pattern)) {
    const value = parseNumberToken(match[1]);
    if (!value) continue;
    const seconds = durationFromParts(value + 0.5, match[2]);
    if (seconds) spans.push({ start: match.index, end: match.index + match[0].length, seconds });
  }
  return spans;
}

function extractUnitDurationSpans(text) {
  const spans = [];
  const pattern = new RegExp(`\\b(?:(?:${numberTokenPattern()})\\s*(?:${strictDurationUnitPattern()})\\s*)+`, "g");
  for (const match of text.matchAll(pattern)) {
    let seconds = 0;
    for (const part of match[0].matchAll(new RegExp(`(${numberTokenPattern()})\\s*(${strictDurationUnitPattern()})`, "g"))) {
      const value = parseNumberToken(part[1]);
      const partSeconds = durationFromParts(value, part[2]);
      if (partSeconds) seconds += partSeconds;
    }
    if (seconds > 0) {
      spans.push({ start: match.index, end: match.index + match[0].length, seconds });
    }
  }
  return spans;
}

function dedupeDurationSpans(spans) {
  const sorted = [...spans].sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return right.end - left.end;
  });
  const result = [];
  for (const span of sorted) {
    const contained = result.some((existing) => span.start >= existing.start && span.end <= existing.end);
    if (!contained) result.push(span);
  }
  return result;
}

function durationPattern() {
  return `(\\d+(?:\\.\\d+)?)\\s*(${strictDurationUnitPattern()})`;
}

function strictDurationUnitPattern() {
  return `(?:${DURATION_UNITS})(?![a-z])`;
}

function numberTokenPattern() {
  const words = [...NUMBER_WORDS.keys()].sort((left, right) => right.length - left.length).map(escapeRegExp);
  return `(?:\\d+(?:\\.\\d+)?|${words.join("|")})`;
}

function parseNumberToken(value) {
  const normalized = String(value || "").toLowerCase().replace(/[-\s]+/g, " ").trim();
  const numeric = Number(normalized);
  if (Number.isFinite(numeric)) return numeric;
  return NUMBER_WORDS.get(normalized) ?? null;
}

function durationFromMatch(match) {
  return durationFromParts(Number(match[1]), match[2]);
}

function durationFromParts(value, unitValue) {
  const unit = String(unitValue || "").toLowerCase();
  if (!Number.isFinite(value)) return null;
  if (unit.startsWith("h")) return Math.round(value * 3600);
  if (unit.startsWith("m")) return Math.round(value * 60);
  return Math.round(value);
}

function uniqueDurations(timers) {
  return [...new Set(timers.map((timer) => timer.seconds))];
}

function clampInteger(value, min, max) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
