export const MAX_INTERVALS = 200;
export const TIMER_DSL_END_TOKEN = "END";
export const TIMER_DSL_DURATION_UNITS =
  "hours?|hrs?|hr|h|minutes?|mins?|minu|mintues?|mintutes?|min|m|seconds?|secs?|sec|s";
const TIMER_DSL_DURATION_PATTERN = `(?:(?:\\d+(?:\\.\\d+)?)\\s*(?:${TIMER_DSL_DURATION_UNITS})\\s*)+`;
export const ALLOWED_TIMER_KINDS = new Set(["warmup", "work", "rest", "cooldown", "other"]);

const DURATION_START_PATTERN = new RegExp(
  `^${TIMER_DSL_DURATION_PATTERN}:\\s*`,
  "i",
);
const REPEAT_START_PATTERN = /^\d+\s*(?:x|alt)\s*/i;
const GENERIC_GROUP_START_PATTERN = new RegExp(
  `^(?:\\d+\\s*x\\s*)?${TIMER_DSL_DURATION_PATTERN}\\s*(?:\\+|around\\b)`,
  "i",
);
const TIMER_DSL_PREFIX_COMPLETIONS = [
  "D",
  "ND",
  "d 1s: Timer",
  "und 1s: Timer",
  "ound 1s: Timer",
  "round 1s: Timer",
  " around 1s: Timer",
  " + 1s: Timer",
  "imer",
  "mer",
  "er",
  "r",
  "s: Timer",
  "m: Timer",
  ": Timer",
  " Timer",
  "1s: Timer",
  " 1s: Timer",
  "t 1s: Timer",
  "lt 1s: Timer",
];
export function parseTimerDsl(content, contextOrOptions = "timer DSL") {
  const options =
    typeof contextOrOptions === "string" ? { context: contextOrOptions } : contextOrOptions ?? {};
  const context = options.context ?? "timer DSL";
  const endToken = options.endToken ?? TIMER_DSL_END_TOKEN;
  const source = stripTimerDslEndToken(stripOutputFence(String(content || "").trim()), endToken);
  const timers = parseTimerDslCommands(source, context);

  if (!timers.length) {
    throw new Error(`${context}: no duration labels found`);
  }
  return { timers };
}

export function isTimerDslPrefix(content, options = {}) {
  return getTimerDslPrefixState(content, options).ok;
}

export function isCompleteTimerDsl(content, options = {}) {
  const state = getTimerDslPrefixState(content, options);
  return state.ok && state.complete;
}

export function getTimerDslPrefixState(content, options = {}) {
  const endToken = options.endToken ?? TIMER_DSL_END_TOKEN;
  const source = stripOutputFence(String(content || ""));
  const trimmed = source.trim();

  if (!trimmed) {
    return { ok: true, complete: false, reason: "empty" };
  }
  if (hasTrailingEndTokenPrefix(trimmed, endToken)) {
    return { ok: true, complete: false, reason: "partial-end-token" };
  }
  if (hasTrailingCommandPrefix(trimmed, endToken)) {
    return { ok: true, complete: false, reason: "partial-command" };
  }
  if (canParseTimerDsl(trimmed, endToken)) {
    return { ok: true, complete: true, reason: "complete" };
  }
  const hardInvalidReason = getTimerDslHardInvalidPrefixReason(source);
  if (hardInvalidReason) {
    return { ok: false, complete: false, reason: "semantic-invalid", detail: hardInvalidReason };
  }

  const completion = findTimerDslPrefixCompletion(source, endToken);
  if (completion !== null) {
    return { ok: true, complete: false, reason: "completion", completion };
  }
  return { ok: false, complete: false, reason: "invalid" };
}

export function isTimerDslHardInvalidPrefix(content) {
  return Boolean(getTimerDslHardInvalidPrefixReason(content));
}

export function findTimerDslStartIndex(text) {
  const source = String(text || "");
  const match = new RegExp(
    `(?:^|[\\s,;])((?:\\d+\\s*(?:x|alt)\\s*)?${TIMER_DSL_DURATION_PATTERN}(?=\\s*(?::|\\+|around\\b)))`,
    "i",
  ).exec(source);
  return match ? match.index + match[0].indexOf(match[1]) : -1;
}

function findTimerDslPrefixCompletion(source, endToken) {
  for (const completion of TIMER_DSL_PREFIX_COMPLETIONS) {
    if (canParseTimerDsl(`${source}${completion}`, endToken)) {
      return completion;
    }
  }
  return null;
}

function hasTrailingEndTokenPrefix(source, endToken) {
  const match = String(source || "").match(/^([\s\S]*\S)\s+(\S+)$/);
  if (!match) return false;

  const prefix = match[2].toUpperCase();
  const normalizedEndToken = String(endToken || "").toUpperCase();
  return (
    prefix.length > 0 &&
    prefix.length < normalizedEndToken.length &&
    normalizedEndToken.startsWith(prefix) &&
    canParseTimerDsl(match[1], endToken)
  );
}

function hasTrailingCommandPrefix(source, endToken) {
  const matches = [...String(source || "").matchAll(/\s+/g)];
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const splitIndex = matches[index].index;
    const before = source.slice(0, splitIndex).trim();
    const tail = source.slice(splitIndex).trim();
    if (!before || !tail) continue;
    if (!canParseTimerDsl(before, endToken)) continue;
    if (canParseTimerDsl(tail, endToken)) continue;
    if (findTimerDslPrefixCompletion(tail, endToken) !== null) return true;
  }
  return false;
}

function canParseTimerDsl(content, endToken) {
  try {
    parseTimerDsl(content, { context: "timer DSL prefix probe", endToken });
    return true;
  } catch {
    return false;
  }
}

export function formatCompactDuration(totalSeconds) {
  const seconds = Number(totalSeconds);
  if (!Number.isInteger(seconds) || seconds < 1) {
    throw new Error(`Invalid duration ${JSON.stringify(totalSeconds)}`);
  }

  let remaining = seconds;
  const hours = Math.floor(remaining / 3600);
  remaining -= hours * 3600;
  const minutes = Math.floor(remaining / 60);
  remaining -= minutes * 60;

  const parts = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remaining || !parts.length) parts.push(`${remaining}s`);
  return parts.join("");
}

export function formatRepeatCommand(count, timerValue) {
  const command = formatTimerCommand(timerValue);
  return count > 1 ? `${count}x ${command}` : command;
}

export function formatTimerCommand(timerValue) {
  const timer = normalizeTimerDslTimer(timerValue);
  return `${formatCompactDuration(timer.durationSeconds)}: ${timer.label}`;
}

export function durationTextToSeconds(durationText) {
  const unitPattern = new RegExp(
    `(\\d+(?:\\.\\d+)?)\\s*(${TIMER_DSL_DURATION_UNITS})`,
    "gi",
  );
  let total = 0;
  let matched = false;

  for (const match of String(durationText || "").matchAll(unitPattern)) {
    matched = true;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (unit.startsWith("h")) total += amount * 3600;
    else if (unit.startsWith("m")) total += amount * 60;
    else total += amount;
  }

  if (!matched) return null;
  return Math.round(total);
}

export function inferTimerKind(label) {
  const value = String(label || "").toLowerCase();
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
  if (value.includes("work") || value.includes("intensity") || value.includes("hard")) {
    return "work";
  }
  return "other";
}

export function canonicalTimerLabel(label, kind) {
  const normalized = String(label || "").trim().toLowerCase();
  if (!normalized) return kindToLabel(kind);
  if (
    normalized === "warmup" ||
    normalized === "warm up" ||
    normalized === "work" ||
    normalized === "rest" ||
    normalized === "cooldown" ||
    normalized === "cool down"
  ) {
    return kindToLabel(kind);
  }
  return String(label || "").trim();
}

export function validateTimerDslTimer(timerValue, context = "timer") {
  if (!timerValue || typeof timerValue !== "object" || Array.isArray(timerValue)) {
    throw new Error(`${context}: expected object`);
  }
  const keys = Object.keys(timerValue).sort();
  const expectedKeys = ["durationSeconds", "kind", "label"];
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`${context}: expected keys ${expectedKeys.join(", ")}, got ${keys.join(", ")}`);
  }

  const label = String(timerValue.label ?? "").trim();
  const durationSeconds = Number(timerValue.durationSeconds);
  const kind = timerValue.kind;

  if (!label || label.length > 48) {
    throw new Error(`${context}: label must be 1-48 characters`);
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86400) {
    throw new Error(`${context}: durationSeconds must be an integer from 1 to 86400`);
  }
  if (!ALLOWED_TIMER_KINDS.has(kind)) {
    throw new Error(`${context}: invalid kind ${JSON.stringify(kind)}`);
  }

  return { label, durationSeconds, kind };
}

export function normalizeTimerDslTimer(timerValue) {
  return {
    label: String(timerValue?.label ?? ""),
    durationSeconds: Number(timerValue?.durationSeconds ?? timerValue?.seconds),
    kind: timerValue?.kind,
  };
}

export function areSameTimerDslTimers(leftValue, rightValue) {
  const left = normalizeTimerDslTimer(leftValue);
  const right = normalizeTimerDslTimer(rightValue);
  return (
    left.label === right.label &&
    left.durationSeconds === right.durationSeconds &&
    left.kind === right.kind
  );
}

export function isNumberedGenericTimerLabel(label) {
  return /^Timer \d+$/i.test(String(label || "").trim());
}

function parseTimerDslCommands(source, context) {
  const commands = splitTimerDslCommands(source);
  if (!commands.length) return [];

  const timers = [];
  for (const [lineIndex, command] of commands.entries()) {
    const parsed = parseTimerDslCommand(command, `${context}: line ${lineIndex + 1}`);
    timers.push(...parsed);
    if (timers.length > MAX_INTERVALS) {
      throw new Error(`${context}: timers must include at most ${MAX_INTERVALS} entries`);
    }
  }

  return numberGenericTimerLabels(timers);
}

function splitTimerDslCommands(source) {
  const value = String(source || "").trim();
  if (!value || !isTimerDslCommandStart(value, "")) return [];

  const starts = [0];
  for (let index = 1; index < value.length; index += 1) {
    if (value[index] === "\n" || value[index] === ";" || value[index] === ",") {
      const start = nextNonWhitespaceIndex(value, index + 1);
      if (start < value.length && isTimerDslCommandStart(value.slice(start), value.slice(0, start))) {
        starts.push(start);
        index = start;
      }
      continue;
    }

    if (!/\s/.test(value[index - 1])) continue;

    const start = nextNonWhitespaceIndex(value, index);
    if (start >= value.length || starts.includes(start)) continue;
    if (!isTimerDslCommandStart(value.slice(start), value.slice(0, start))) continue;

    starts.push(start);
    index = start;
  }

  starts.sort((left, right) => left - right);
  return starts
    .map((start, index) => value.slice(start, starts[index + 1] ?? value.length))
    .map((command) => command.replace(/^[\s,;]+|[\s,;]+$/g, ""))
    .filter(Boolean);
}

function isTimerDslCommandStart(tail, before) {
  if (previousNonWhitespace(before) === "|") return false;
  if (previousNonWhitespace(before) === "+") return false;
  if (/(?:^|\s)\d+\s*(?:x|alt)\s*$/i.test(before)) return false;
  if (/(?:^|\s)around\s*$/i.test(before)) return false;
  return REPEAT_START_PATTERN.test(tail) || DURATION_START_PATTERN.test(tail) || GENERIC_GROUP_START_PATTERN.test(tail);
}

function parseTimerDslCommand(command, context) {
  const groupedCommand = parseGenericGroupCommand(command, context);
  if (groupedCommand) return groupedCommand;

  const match = String(command || "").match(/^(?:(\d+)\s*(x|alt)\s*)?([\s\S]+)$/i);
  if (!match) throw new Error(`${context}: expected timer command`);

  const count = match[1] ? Number(match[1]) : 1;
  const mode = match[2]?.toLowerCase() ?? "once";
  const body = match[3].trim();
  if (!Number.isInteger(count) || count < 1 || count > MAX_INTERVALS) {
    throw new Error(`${context}: repeat count must be 1-${MAX_INTERVALS}`);
  }
  if (!body) throw new Error(`${context}: expected duration: label`);

  const atoms = body.split(/\s*\|\s*/).map((atom, index) => parseDslAtom(atom, `${context}: atom ${index + 1}`));
  if (mode === "once") {
    return atoms.map((atom, index) => validateTimerDslTimer(atom, `${context}: timer ${index + 1}`));
  }

  const timers = [];
  const emitCount = mode === "alt" ? count : count * atoms.length;
  for (let index = 0; index < emitCount; index += 1) {
    const atom = atoms[index % atoms.length];
    timers.push(validateTimerDslTimer({ ...atom }, `${context}: timer ${index + 1}`));
  }
  return timers;
}

function parseGenericGroupCommand(command, context) {
  const source = String(command || "").trim();
  const match = source.match(/^([\s\S]+?)\s*:\s*(.+?)\s*$/);
  if (!match) {
    if (/[+]|\baround\b/i.test(source)) {
      throw new Error(`${context}: expected grouped duration expression followed by : label`);
    }
    return null;
  }

  const expression = match[1].trim();
  if (!/[+]/.test(expression) && !/\baround\b/i.test(expression)) return null;

  const label = normalizeTimerLabel(match[2]);
  if (label.toLowerCase() !== "timer") {
    throw new Error(`${context}: grouped generic syntax must use Timer as the label`);
  }
  const kind = "other";
  const canonicalLabel = "Timer";

  if (/\baround\b/i.test(expression)) {
    const aroundMatch = expression.match(/^([\s\S]+?)\s+around\s+([\s\S]+)$/i);
    if (!aroundMatch) throw new Error(`${context}: expected duration around duration expression`);

    const bookendGroups = parseGenericGroupTerms(aroundMatch[1], `${context}: bookend`);
    if (bookendGroups.length !== 1 || bookendGroups[0].count !== 1) {
      throw new Error(`${context}: around requires one unrepeated bookend duration`);
    }
    const middleGroups = parseGenericGroupTerms(aroundMatch[2], `${context}: middle`);
    return expandGenericGroups([...bookendGroups, ...middleGroups, ...bookendGroups], canonicalLabel, kind, context);
  }

  const groups = parseGenericGroupTerms(expression, `${context}: group`);
  if (groups.length < 2) throw new Error(`${context}: grouped duration expression must contain at least two terms`);
  return expandGenericGroups(groups, canonicalLabel, kind, context);
}

function getTimerDslHardInvalidPrefixReason(content) {
  const source = stripTimerDslEndToken(stripOutputFence(String(content || "")), TIMER_DSL_END_TOKEN);
  const commands = splitTimerDslCommands(source);
  if (!commands.length) return null;

  for (const [index, command] of commands.entries()) {
    const reason = getGenericGroupHardInvalidReason(command);
    if (reason) return `line ${index + 1}: ${reason}`;
  }
  return null;
}

function getGenericGroupHardInvalidReason(command) {
  const source = String(command || "").trim();
  const colonIndex = source.indexOf(":");
  const expression = (colonIndex >= 0 ? source.slice(0, colonIndex) : source).trim();
  if (!/[+]/.test(expression) && !/\baround\b/i.test(expression)) return null;

  if (/\b\d+\s*alt\b/i.test(expression)) {
    return "grouped generic syntax cannot contain alt";
  }
  if (expression.includes("|")) {
    return "grouped generic syntax cannot contain block separators";
  }

  if (colonIndex >= 0) {
    const labelPrefix = normalizeTimerLabel(source.slice(colonIndex + 1)).toLowerCase();
    if (labelPrefix && !"timer".startsWith(labelPrefix)) {
      return "grouped generic syntax must use Timer as the label";
    }
  }

  return null;
}

function parseGenericGroupTerms(expression, context) {
  const terms = String(expression || "")
    .split(/\s*\+\s*/)
    .map((term) => term.trim());
  if (!terms.length || terms.some((term) => !term)) {
    throw new Error(`${context}: expected duration terms`);
  }
  return terms.map((term, index) => parseGenericGroupTerm(term, `${context}: term ${index + 1}`));
}

function parseGenericGroupTerm(term, context) {
  const match = String(term || "").match(new RegExp(`^(?:(\\d+)\\s*x\\s*)?(${TIMER_DSL_DURATION_PATTERN})$`, "i"));
  if (!match) throw new Error(`${context}: expected duration or Nx duration`);

  const count = match[1] ? Number(match[1]) : 1;
  if (!Number.isInteger(count) || count < 1 || count > MAX_INTERVALS) {
    throw new Error(`${context}: repeat count must be 1-${MAX_INTERVALS}`);
  }
  return {
    count,
    durationSeconds: durationTextToSeconds(match[2]),
  };
}

function expandGenericGroups(groups, label, kind, context) {
  const timers = [];
  for (const group of groups) {
    for (let index = 0; index < group.count; index += 1) {
      timers.push(
        validateTimerDslTimer(
          { label, durationSeconds: group.durationSeconds, kind },
          `${context}: timer ${timers.length + 1}`,
        ),
      );
    }
  }
  return timers;
}

function parseDslAtom(atom, context) {
  const match = String(atom || "")
    .trim()
    .match(
      new RegExp(
        `^(${TIMER_DSL_DURATION_PATTERN})\\s*:\\s*(.+?)\\s*$`,
        "i",
      ),
    );
  if (!match) throw new Error(`${context}: expected duration: label`);

  const durationSeconds = durationTextToSeconds(match[1]);
  const label = normalizeTimerLabel(match[2]);
  const kind = inferTimerKind(label);
  return {
    label: canonicalTimerLabel(label, kind),
    durationSeconds,
    kind,
  };
}

function numberGenericTimerLabels(timers) {
  let genericTimerIndex = 1;
  return timers.map((timerValue) => {
    const timer = normalizeTimerDslTimer(timerValue);
    if (timer.kind === "other" && String(timer.label).trim().toLowerCase() === "timer") {
      return { ...timer, label: `Timer ${genericTimerIndex++}` };
    }
    if (isNumberedGenericTimerLabel(timer.label)) genericTimerIndex += 1;
    return timer;
  });
}

function normalizeTimerLabel(label) {
  return String(label || "")
    .replace(/^[\s,;:-]+|[\s,;:.!?-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function stripOutputFence(content) {
  const trimmed = String(content || "").trim();
  const fenceMatch = trimmed.match(/^```(?:text|txt|timey|json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function stripTimerDslEndToken(content, endToken) {
  const escapedEndToken = endToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return String(content || "")
    .replace(new RegExp(`\\s+(?:${escapedEndToken}|<${escapedEndToken}>)(?=\\s|$)[\\s\\S]*$`, "i"), "")
    .trim();
}

function nextNonWhitespaceIndex(value, start) {
  let index = start;
  while (/\s/.test(value[index] || "")) index += 1;
  return index;
}

function previousNonWhitespace(value) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (!/\s/.test(value[index])) return value[index];
  }
  return "";
}

function kindToLabel(kind) {
  if (kind === "warmup") return "Warmup";
  if (kind === "work") return "Work";
  if (kind === "rest") return "Rest";
  if (kind === "cooldown") return "Cooldown";
  return "Timer";
}
