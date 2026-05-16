export const MAX_INTERVALS = 200;

export const KIND_META = {
  warmup: { label: "Warmup", color: "#f28c28" },
  work: { label: "Work", color: "#d94f45" },
  rest: { label: "Rest", color: "#3867d6" },
  cooldown: { label: "Cooldown", color: "#2f9e44" },
  other: { label: "Other", color: "#0f8b8d" },
};

export function planWithFallback(text, currentTimers = [], conversation = []) {
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
    timers.push(...explicitGenericTimers);
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
    .replaceAll(",", " ")
    .replaceAll(";", " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferKind(label) {
  const value = String(label).toLowerCase();
  if (value.includes("warmdown") || value.includes("warm down")) return "cooldown";
  if (value.includes("warm")) return "warmup";
  if (value.includes("cool")) return "cooldown";
  if (
    value.includes("low intensity") ||
    value.includes("rest") ||
    value.includes("recover") ||
    value.includes("easy")
  ) {
    return "rest";
  }
  if (value.includes("work") || value.includes("intensity") || value.includes("hard")) return "work";
  return "other";
}

export function isCorrection(text) {
  return /(\bwrong\b|actually|instead|not\s+\d+|must have|should\s+(?:be|have)|should've|shoudl|correction|change it|fix it|wanted|meant|removed|too many|too few|twice as little|half as many|twice less|fewer|like (?:i )?described|at first|middle ones?)/.test(
    text,
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
    sixteen: 16,
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
  return String(text).replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|sixteen|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/gi,
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
  return /(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|sixteen)\s+$/.test(
    before,
  );
}

function mentionsWorkAndRest(text) {
  return mentionsRestLike(text) && mentionsWorkLike(text);
}

function mentionsAlternating(text) {
  return /(alternating|alterating|alternate|alternations?|alterations?|blocks?|rounds?|cycles?|steps?|sets?|middle|middle ones)/.test(
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

function extractExplicitGenericTimers(text) {
  if (!/\b(?:timers?|intervals?)\b/.test(text)) return [];
  if (
    mentionsAlternating(text) ||
    mentionsRestLike(text) ||
    mentionsWorkLike(text) ||
    hasEndpointLabel(text)
  ) {
    return [];
  }

  const timers = [];
  const countedDurationPattern = new RegExp(
    `\\b(\\d+)\\s+${durationPattern()}\\s*(?:timers?|intervals?)?`,
    "g",
  );

  for (const match of text.matchAll(countedDurationPattern)) {
    const count = clampInteger(match[1], 1, MAX_INTERVALS - timers.length);
    const seconds = durationFromMatch([match[0], match[2], match[3]]);
    if (!seconds) continue;
    for (let index = 0; index < count && timers.length < MAX_INTERVALS; index += 1) {
      timers.push(makeTimer("Timer", seconds, "other"));
    }
  }

  return timers;
}

function extractTotalIntervals(text) {
  const match = text.match(/(\d+)\s*(?:timers?|intervals?)/);
  return match ? clampInteger(match[1], 1, MAX_INTERVALS) : null;
}

function extractMiddleIntervalCount(text) {
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
  return /\b(warmup|warm up|cooldown|cool down|warmdown|warm down)\b/.test(text);
}

function firstUsefulDuration(text) {
  for (const match of text.matchAll(new RegExp(durationPattern(), "g"))) {
    const seconds = durationFromMatch(match);
    if (seconds) return seconds;
  }
  return null;
}

function durationPattern() {
  return "(\\d+(?:\\.\\d+)?)\\s*(hours?|hrs?|hr|h|minutes?|mins?|minu|mintues?|mintutes?|min|m|seconds?|secs?|sec|s)";
}

function durationFromMatch(match) {
  const value = Number(match[1]);
  const unit = match[2];
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
