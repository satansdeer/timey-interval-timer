import { KIND_META, MAX_INTERVALS, inferKind, isCorrection, normalizePrompt } from "./fallback-planner.js";
import { planTimers as planTimersWithPlanner } from "./planner.js";

export const ASSISTANT_NAME = "Timmy";
export const ASSISTANT_CONVERSATION_VERSION = 3;
export const ASSISTANT_MAX_LOG_MESSAGES = 24;
export const INITIAL_ASSISTANT_TEXT =
  "Tell me your warmup, intervals, rests, and cooldown. I will schedule the workout.";
export const INITIAL_ASSISTANT_BUBBLE_TEXT = "Ask Timmy to set up your timers.";

export function defaultState({ now = new Date() } = {}) {
  return {
    timers: [
      createTimer("Warmup", 5 * 60, "warmup"),
      createTimer("High intensity", 60, "work"),
      createTimer("Rest", 60, "rest"),
      createTimer("Cooldown", 5 * 60, "cooldown"),
    ],
    player: {
      status: "idle",
      elapsedBeforeStartMs: 0,
      startedAtMs: null,
    },
    conversation: [
      {
        role: "assistant",
        text: INITIAL_ASSISTANT_TEXT,
        source: "sys",
        createdAt: now.toISOString(),
      },
    ],
    assistantConversationVersion: ASSISTANT_CONVERSATION_VERSION,
  };
}

export function createTimer(label, seconds, kind = "work") {
  return {
    id: globalThis.crypto?.randomUUID
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`,
    label,
    seconds: clampInteger(seconds, 1, 86400),
    kind: KIND_META[kind] ? kind : "other",
  };
}

export function normalizePlayer(player) {
  const status = ["idle", "running", "paused", "finished"].includes(player?.status)
    ? player.status
    : "idle";
  return {
    status,
    elapsedBeforeStartMs: Math.max(0, Number(player?.elapsedBeforeStartMs) || 0),
    startedAtMs: status === "running" ? Number(player?.startedAtMs) || Date.now() : null,
  };
}

export function normalizeTimers(input) {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_INTERVALS)
    .map((timer) => {
      const label = String(timer.label || "Interval").trim().slice(0, 48);
      const seconds = clampInteger(
        timer.seconds ?? timer.durationSeconds ?? timer.duration ?? 60,
        1,
        86400,
      );
      const kind = KIND_META[timer.kind] ? timer.kind : inferKind(label);
      return createTimer(label || KIND_META[kind].label, seconds, kind);
    })
    .filter((timer) => timer.seconds > 0);
}

export async function submitAssistantText({
  state,
  text,
  useTinyLlm = false,
  onStatus,
  now = Date.now,
}) {
  const trimmedText = String(text || "").trim();
  if (!trimmedText) throw new Error("Prompt is empty.");

  addAssistantMessage(state, "user", trimmedText, "user");

  try {
    const plan = await planTimersWithPlanner({
      text: trimmedText,
      currentTimers: state.timers,
      conversation: state.conversation,
      useTinyLlm,
      onStatus,
    });
    applyTimerPlanToState(state, plan, { now });
    const reply = createAssistantReply(plan, trimmedText);
    addAssistantMessage(
      state,
      "assistant",
      reply,
      getPlanSourceLabel(plan),
      createPlannerLogDetails(plan, state.timers),
    );
    return { ok: true, plan, reply, state };
  } catch (error) {
    const reply = createAssistantErrorReply(error);
    addAssistantMessage(state, "assistant", reply, "error", {
      error: error?.message || "Unknown planner error",
    });
    return { ok: false, error, reply, state };
  }
}

export function applyTimerPlanToState(state, plan, { now = Date.now } = {}) {
  const timers = normalizeTimers(plan.timers);
  if (!timers.length) throw new Error("No timers returned.");
  snapshotElapsedBeforeSequenceChange(state, { now });
  state.timers = timers;
  state.player.elapsedBeforeStartMs = Math.min(state.player.elapsedBeforeStartMs, getTotalMs(state));
  return state.timers;
}

export function createAssistantReply(plan, userText) {
  const totalSeconds = plan.timers.reduce((total, timer) => total + timer.seconds, 0);
  const counts = plan.timers.reduce((accumulator, timer) => {
    accumulator[timer.kind] = (accumulator[timer.kind] || 0) + 1;
    return accumulator;
  }, {});
  const totalLabel = formatClock(totalSeconds * 1000);
  const workRest =
    counts.work && counts.rest ? ` ${counts.work} work, ${counts.rest} rest.` : "";
  const correction = isCorrection(normalizePrompt(userText));
  const openings = correction
    ? [
        "Aha, recalibrating my tiny wire spine.",
        "You are correct; my previous math wore roller skates.",
        "Correction accepted. I have put the intervals back in little rows.",
      ]
    : [
        "It looks like you are trying to manufacture sweat. I can help with that.",
        "Boop. I folded your words into timers.",
        "I have arranged the minute bricks.",
      ];
  const opening = openings[Math.abs(hashText(userText)) % openings.length];

  return `${opening} ${plan.timers.length} intervals, ${totalLabel} total.${workRest}`;
}

export function createAssistantErrorReply(error) {
  const message = error?.message || "Could not read that timer spell.";
  return `I could not schedule that yet. ${message}`;
}

export function getPlanSourceLabel(plan) {
  if (plan.source === "tiny-llm") return "tiny-llm";
  if (plan.source === "fallback") return "fallback";
  return plan.source || "unknown";
}

export function createPlannerLogDetails(plan, timers) {
  return {
    fallbackReason: plan.fallbackReason || null,
    model: plan.model || null,
    timerSummary: summarizeTimersForLog(timers),
    timers: timers.map(({ label, seconds, kind }) => ({ label, seconds, kind })),
  };
}

export function summarizeTimersForLog(timers) {
  const totalSeconds = timers.reduce((total, timer) => total + timer.seconds, 0);
  const counts = timers.reduce((accumulator, timer) => {
    accumulator[timer.kind] = (accumulator[timer.kind] || 0) + 1;
    return accumulator;
  }, {});
  return [
    `${timers.length} intervals`,
    `${formatClock(totalSeconds * 1000)} total`,
    `${counts.warmup || 0} warmup`,
    `${counts.work || 0} work`,
    `${counts.rest || 0} rest`,
    `${counts.cooldown || 0} cooldown`,
  ].join("; ");
}

export function formatConversationForCopy(state, { draft = "" } = {}) {
  const lines = state.conversation.map((message, index) => {
    const speaker = message.role === "user" ? "User" : ASSISTANT_NAME;
    const timestamp = message.createdAt || "unknown time";
    const source = message.source || (message.role === "user" ? "user" : "unknown");
    const header = `${index + 1}. [${timestamp}] ${speaker} (source: ${source})`;
    const details = [];

    if (message.model) details.push(`model: ${message.model}`);
    if (message.fallbackReason) details.push(`fallback reason: ${message.fallbackReason}`);
    if (message.error) details.push(`error: ${message.error}`);
    if (message.timerSummary) details.push(`timers after message: ${message.timerSummary}`);
    if (Array.isArray(message.timers) && message.timers.length) {
      details.push(
        [
          "timer list:",
          ...message.timers.map(
            (timer, timerIndex) =>
              `${timerIndex + 1}. ${timer.label} - ${formatClock(timer.seconds * 1000)} (${timer.kind})`,
          ),
        ].join("\n"),
      );
    }

    return [header, message.text, ...details].join("\n");
  });
  const trimmedDraft = String(draft || "").trim();
  if (trimmedDraft) lines.push(`Current draft (not sent): ${trimmedDraft}`);
  return lines.join("\n\n");
}

export function addAssistantMessage(state, role, text, source = null, details = {}) {
  state.conversation.push({
    role,
    text,
    source: source || (role === "user" ? "user" : "unknown"),
    createdAt: new Date().toISOString(),
    ...details,
  });
  state.conversation = state.conversation.slice(-ASSISTANT_MAX_LOG_MESSAGES);
}

export function snapshotElapsedBeforeSequenceChange(state, { now = Date.now } = {}) {
  if (state.player.status !== "running") return;
  const timestamp = typeof now === "function" ? now() : now;
  state.player.elapsedBeforeStartMs = getElapsedMs(state, timestamp);
  state.player.startedAtMs = timestamp;
}

export function getElapsedMs(state, now = Date.now()) {
  const totalMs = getTotalMs(state);
  if (state.player.status === "running") {
    return clampNumber(
      state.player.elapsedBeforeStartMs + Math.max(0, now - state.player.startedAtMs),
      0,
      totalMs,
    );
  }
  return clampNumber(state.player.elapsedBeforeStartMs, 0, totalMs);
}

export function getTotalMs(state) {
  return state.timers.reduce((total, timer) => total + timer.seconds * 1000, 0);
}

export function formatClock(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${pad2(minutes)}:${pad2(seconds)}`;
}

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash << 5) - hash + text.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function clampInteger(value, min, max) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
