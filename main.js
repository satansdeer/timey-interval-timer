import {
  KIND_META,
  getWorkoutShape,
  inferKind,
  normalizePrompt,
  planWithFallback,
} from "./fallback-planner.js";
import {
  ASSISTANT_CONVERSATION_VERSION,
  ASSISTANT_MAX_LOG_MESSAGES,
  ASSISTANT_NAME,
  INITIAL_ASSISTANT_BUBBLE_TEXT,
  createAssistantReply,
  createTimer,
  defaultState,
  formatClock,
  formatConversationForCopy,
  getElapsedMs as getSessionElapsedMs,
  getTotalMs as getSessionTotalMs,
  normalizePlayer,
  normalizeTimers,
  snapshotElapsedBeforeSequenceChange as snapshotSessionElapsedBeforeSequenceChange,
  submitAssistantText,
} from "./assistant-session.js";
import { getPlannerStatus } from "./planner.js";
import {
  canUseTinyLlm,
  getTinyLlmAssetKey,
  isTinyLlmLoaded,
  preloadTinyLlm,
} from "./llm-planner.js";

const LEGACY_STORAGE_KEY = "interval-studio-state-v1";
const LEGACY_MODEL_CHOICE_KEY = "interval-studio-model-choice-v1";
const STORAGE_KEY = "timey-state-v1";
const MODEL_CHOICE_KEY = "timey-model-choice-v1";
const MODEL_ASSET_KEY = "timey-model-asset-key-v1";

const elements = {
  saveState: document.querySelector("#saveState"),
  installButton: document.querySelector("#installButton"),
  resetDataButton: document.querySelector("#resetDataButton"),
  currentTitle: document.querySelector("#currentTitle"),
  nextTitle: document.querySelector("#nextTitle"),
  timerDial: document.querySelector("#timerDial"),
  timerElapsed: document.querySelector("#timerElapsed"),
  timerTime: document.querySelector("#timerTime"),
  timerSubtime: document.querySelector("#timerSubtime"),
  startPauseButton: document.querySelector("#startPauseButton"),
  stopButton: document.querySelector("#stopButton"),
  previousButton: document.querySelector("#previousButton"),
  nextButton: document.querySelector("#nextButton"),
  timeline: document.querySelector("#timeline"),
  sequenceSummary: document.querySelector("#sequenceSummary"),
  addIntervalButton: document.querySelector("#addIntervalButton"),
  intervalList: document.querySelector("#intervalList"),
  assistantWidget: document.querySelector("#assistantWidget"),
  assistantPopover: document.querySelector("#assistantPopover"),
  assistantToggleButton: document.querySelector("#assistantToggleButton"),
  assistantCloseButton: document.querySelector("#assistantCloseButton"),
  assistantStatus: document.querySelector("#assistantStatus"),
  assistantBubbleText: document.querySelector("#assistantBubbleText"),
  assistantThinking: document.querySelector("#assistantThinking"),
  assistantForm: document.querySelector("#assistantForm"),
  assistantInput: document.querySelector("#assistantInput"),
  copyConversationButton: document.querySelector("#copyConversationButton"),
  assistantSubmit: document.querySelector("#assistantSubmit"),
  modelModal: document.querySelector("#modelModal"),
  modelModalTitle: document.querySelector("#modelModalTitle"),
  modelModalText: document.querySelector("#modelModalText"),
  modelLoadPanel: document.querySelector("#modelLoadPanel"),
  modelModalStatus: document.querySelector("#modelModalStatus"),
  modelProgressFill: document.querySelector("#modelProgressFill"),
  loadModelButton: document.querySelector("#loadModelButton"),
  useFallbackButton: document.querySelector("#useFallbackButton"),
};

const kindMeta = KIND_META;

let state = loadState();
let deferredInstallPrompt = null;
let lastRenderedSegmentIndex = null;
let audioContext = null;
let tinyLlmEnabled = false;
let modelLoadStarted = false;
let assistantIsThinking = false;
let assistantBubbleText = INITIAL_ASSISTANT_BUBBLE_TEXT;

init();

function init() {
  bindEvents();
  registerServiceWorker();
  detectAssistantMode();
  maybeOfferTinyLlm();
  renderAll();
  window.setInterval(renderPlayer, 250);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    const timers = normalizeTimers(parsed.timers);
    if (!timers.length) return defaultState();
    return {
      timers,
      player: normalizePlayer(parsed.player),
      conversation:
        parsed.assistantConversationVersion === ASSISTANT_CONVERSATION_VERSION &&
        Array.isArray(parsed.conversation)
        ? parsed.conversation.slice(-ASSISTANT_MAX_LOG_MESSAGES)
        : defaultState().conversation,
      assistantConversationVersion: ASSISTANT_CONVERSATION_VERSION,
    };
  } catch {
    return defaultState();
  }
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  elements.saveState.textContent = "Saved locally";
}

function markDirty() {
  elements.saveState.textContent = "Saving...";
  persist();
}

function bindEvents() {
  elements.startPauseButton.addEventListener("click", toggleStartPause);
  elements.stopButton.addEventListener("click", stopTimer);
  elements.previousButton.addEventListener("click", previousInterval);
  elements.nextButton.addEventListener("click", nextInterval);
  elements.addIntervalButton.addEventListener("click", addInterval);
  elements.resetDataButton.addEventListener("click", resetData);
  elements.intervalList.addEventListener("change", handleIntervalInput);
  elements.intervalList.addEventListener("click", handleIntervalAction);
  elements.assistantToggleButton.addEventListener("click", toggleAssistantPopover);
  elements.assistantCloseButton.addEventListener("click", closeAssistantPopover);
  elements.assistantForm.addEventListener("submit", handleAssistantSubmit);
  elements.assistantInput.addEventListener("input", resizeAssistantInput);
  elements.assistantInput.addEventListener("keydown", handleAssistantKeydown);
  elements.copyConversationButton.addEventListener("click", handleCopyConversation);
  elements.loadModelButton.addEventListener("click", handleLoadModelClick);
  elements.useFallbackButton.addEventListener("click", handleUseFallbackClick);

  document.addEventListener("keydown", handleGlobalKeydown);

  document.addEventListener("visibilitychange", () => {
    renderPlayer();
    persist();
  });

  window.addEventListener("beforeunload", persist);

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });

  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });
}

function toggleStartPause() {
  unlockAudio();
  const now = Date.now();
  const totalMs = getTotalMs();
  const elapsedMs = getElapsedMs(now);

  if (state.player.status === "running") {
    state.player.status = "paused";
    state.player.elapsedBeforeStartMs = elapsedMs;
    state.player.startedAtMs = null;
  } else {
    state.player.elapsedBeforeStartMs =
      state.player.status === "finished" || elapsedMs >= totalMs ? 0 : elapsedMs;
    state.player.startedAtMs = now;
    state.player.status = "running";
    lastRenderedSegmentIndex = getSegmentAt(getElapsedMs(now)).index;
  }

  markDirty();
  renderAll();
}

function stopTimer() {
  state.player.status = "idle";
  state.player.elapsedBeforeStartMs = 0;
  state.player.startedAtMs = null;
  lastRenderedSegmentIndex = null;
  markDirty();
  renderAll();
}

function previousInterval() {
  const location = getSegmentAt(getElapsedMs());
  const targetIndex = Math.max(0, location.index - (location.segmentElapsedMs > 2500 ? 0 : 1));
  seekToSegment(targetIndex);
}

function nextInterval() {
  const location = getSegmentAt(getElapsedMs());
  seekToSegment(Math.min(state.timers.length - 1, location.index + 1));
}

function seekToSegment(index) {
  const elapsedBefore = state.timers
    .slice(0, index)
    .reduce((total, timer) => total + timer.seconds * 1000, 0);

  if (state.player.status === "running") {
    state.player.elapsedBeforeStartMs = elapsedBefore;
    state.player.startedAtMs = Date.now();
  } else {
    state.player.elapsedBeforeStartMs = elapsedBefore;
  }

  lastRenderedSegmentIndex = index;
  markDirty();
  renderAll();
}

function addInterval() {
  snapshotElapsedBeforeSequenceChange();
  state.timers.push(createTimer("Work", 60, "work"));
  markDirty();
  renderAll();
}

function resetData() {
  state = defaultState();
  assistantIsThinking = false;
  assistantBubbleText = INITIAL_ASSISTANT_BUBBLE_TEXT;
  elements.assistantInput.value = "";
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem(MODEL_CHOICE_KEY);
  localStorage.removeItem(MODEL_ASSET_KEY);
  localStorage.removeItem(LEGACY_MODEL_CHOICE_KEY);
  lastRenderedSegmentIndex = null;
  persist();
  renderAll();
}

function handleIntervalInput(event) {
  const card = event.target.closest("[data-id]");
  if (!card) return;
  const timer = state.timers.find((item) => item.id === card.dataset.id);
  if (!timer) return;

  snapshotElapsedBeforeSequenceChange();

  if (event.target.matches("[data-field='label']")) {
    timer.label = event.target.value.trim().slice(0, 48) || kindMeta[timer.kind].label;
    timer.kind = inferKind(timer.label);
  }

  if (event.target.matches("[data-field='minutes'], [data-field='seconds']")) {
    const minutes = Number(card.querySelector("[data-field='minutes']").value) || 0;
    const seconds = Number(card.querySelector("[data-field='seconds']").value) || 0;
    timer.seconds = clampInteger(minutes * 60 + seconds, 1, 86400);
  }

  markDirty();
  renderAll();
}

function handleIntervalAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const card = button.closest("[data-id]");
  const index = state.timers.findIndex((item) => item.id === card?.dataset.id);
  if (index < 0) return;

  snapshotElapsedBeforeSequenceChange();

  if (button.dataset.action === "up" && index > 0) {
    [state.timers[index - 1], state.timers[index]] = [state.timers[index], state.timers[index - 1]];
  }

  if (button.dataset.action === "down" && index < state.timers.length - 1) {
    [state.timers[index + 1], state.timers[index]] = [state.timers[index], state.timers[index + 1]];
  }

  if (button.dataset.action === "duplicate") {
    const timer = state.timers[index];
    state.timers.splice(index + 1, 0, createTimer(`${timer.label} copy`, timer.seconds, timer.kind));
  }

  if (button.dataset.action === "delete" && state.timers.length > 1) {
    state.timers.splice(index, 1);
  }

  markDirty();
  renderAll();
}

function handleAssistantKeydown(event) {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  elements.assistantForm.requestSubmit();
}

function toggleAssistantPopover() {
  if (elements.assistantPopover.hidden) {
    openAssistantPopover();
    return;
  }
  elements.assistantInput.focus({ preventScroll: true });
}

function openAssistantPopover({ focusInput = true } = {}) {
  elements.assistantPopover.hidden = false;
  elements.assistantToggleButton.setAttribute("aria-expanded", "true");
  elements.assistantToggleButton.setAttribute("aria-label", "Focus Timmy timer assistant");
  elements.assistantToggleButton.title = "Timmy";

  window.requestAnimationFrame(() => {
    resizeAssistantInput();
    if (focusInput) elements.assistantInput.focus({ preventScroll: true });
  });
}

function closeAssistantPopover() {
  elements.assistantPopover.hidden = true;
  elements.assistantToggleButton.setAttribute("aria-expanded", "false");
  elements.assistantToggleButton.setAttribute("aria-label", "Open Timmy assistant");
  elements.assistantToggleButton.title = "Timmy";
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape" || elements.assistantPopover.hidden) return;
  closeAssistantPopover();
  elements.assistantToggleButton.focus({ preventScroll: true });
}

function resizeAssistantInput() {
  elements.assistantInput.style.height = "auto";
  elements.assistantInput.style.height = `${Math.min(elements.assistantInput.scrollHeight, 136)}px`;
}

function maybeOfferTinyLlm() {
  if (!canUseTinyLlm()) {
    tinyLlmEnabled = false;
    elements.assistantStatus.textContent = `${ASSISTANT_NAME} - fallback parser`;
    return;
  }

  const choice = getStoredModelChoice();
  if (choice === "enabled") {
    startTinyLlmLoad({ automatic: true });
    return;
  }
  if (choice === "fallback") {
    tinyLlmEnabled = false;
    elements.assistantStatus.textContent = `${ASSISTANT_NAME} - fallback parser`;
    return;
  }

  showModelModal();
}

function showModelModal() {
  elements.modelModal.hidden = false;
  elements.modelLoadPanel.hidden = true;
  setModelLoadProgress(0);
  elements.modelModalStatus.textContent = "Ready.";
  elements.loadModelButton.disabled = false;
  elements.useFallbackButton.disabled = false;
}

function hideModelModal() {
  elements.modelModal.hidden = true;
}

function handleLoadModelClick() {
  localStorage.setItem(MODEL_CHOICE_KEY, "enabled");
  localStorage.removeItem(LEGACY_MODEL_CHOICE_KEY);
  startTinyLlmLoad({ automatic: false });
}

function handleUseFallbackClick() {
  localStorage.setItem(MODEL_CHOICE_KEY, "fallback");
  localStorage.removeItem(LEGACY_MODEL_CHOICE_KEY);
  tinyLlmEnabled = false;
  elements.assistantStatus.textContent = `${ASSISTANT_NAME} - fallback parser`;
  hideModelModal();
}

function getStoredModelChoice() {
  const choice = localStorage.getItem(MODEL_CHOICE_KEY);
  if (choice) return choice;

  const legacyChoice = localStorage.getItem(LEGACY_MODEL_CHOICE_KEY);
  if (legacyChoice) {
    localStorage.setItem(MODEL_CHOICE_KEY, legacyChoice);
    localStorage.removeItem(LEGACY_MODEL_CHOICE_KEY);
  }
  return legacyChoice;
}

async function startTinyLlmLoad({ automatic }) {
  if (modelLoadStarted) return;
  modelLoadStarted = true;
  tinyLlmEnabled = false;
  elements.loadModelButton.disabled = true;
  elements.useFallbackButton.disabled = true;
  elements.modelLoadPanel.hidden = false;
  setModelLoadProgress(0);
  if (!automatic) {
    elements.modelModalStatus.textContent = "Loading...";
  }
  elements.assistantStatus.textContent = "Loading tiny LLM";

  try {
    const modelId = await preloadTinyLlm((status, progress) => {
      elements.assistantStatus.textContent = status;
      if (!elements.modelModal.hidden) {
        elements.modelModalStatus.textContent = getFriendlyModelStatus(status, progress);
        setModelLoadProgress(progress);
      }
    });
    tinyLlmEnabled = true;
    localStorage.setItem(MODEL_ASSET_KEY, getTinyLlmAssetKey(modelId));
    elements.assistantStatus.textContent = `Tiny LLM - ${modelId}`;
    hideModelModal();
  } catch (error) {
    tinyLlmEnabled = false;
    elements.assistantStatus.textContent = `${ASSISTANT_NAME} - fallback parser`;
    const message = error?.message || "Could not load the model. Falling back to the parser.";
    if (automatic) {
      elements.assistantStatus.textContent = `${ASSISTANT_NAME} - fallback parser`;
      return;
    }
    elements.modelModalStatus.textContent = message;
    setModelLoadProgress(0);
    elements.loadModelButton.disabled = false;
    elements.useFallbackButton.disabled = false;
    modelLoadStarted = false;
  }
}

function setModelLoadProgress(progress) {
  const value = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
  elements.modelProgressFill.style.width = `${Math.round(value * 100)}%`;
}

function getFriendlyModelStatus(status, progress) {
  if (Number.isFinite(progress) && progress > 0 && progress < 1) {
    return `${Math.round(progress * 100)}%`;
  }
  if (/finish|ready|loaded/i.test(status)) return "Ready.";
  return "Loading...";
}

async function handleAssistantSubmit(event) {
  event.preventDefault();
  const text = elements.assistantInput.value.trim();
  if (!text) return;

  elements.assistantInput.value = "";
  assistantIsThinking = true;
  assistantBubbleText = "Timmy is setting up your timers.";
  renderAssistantBubble();
  elements.assistantSubmit.disabled = true;
  elements.assistantSubmit.textContent = "Thinking";

  try {
    const result = await submitAssistantText({
      state,
      text,
      useTinyLlm: tinyLlmEnabled && isTinyLlmLoaded(),
      onStatus: (status) => {
        elements.assistantStatus.textContent = status;
      },
    });
    assistantBubbleText = result.reply;
    if (result.plan) updateAssistantStatusFromPlan(result.plan);
    markDirty();
  } catch (error) {
    assistantBubbleText = `I could not schedule that yet. ${error?.message || "Unknown planner error"}`;
  } finally {
    assistantIsThinking = false;
    elements.assistantSubmit.disabled = false;
    elements.assistantSubmit.textContent = "Send";
    renderAll();
  }
}

async function handleCopyConversation() {
  const text = formatConversationForCopy(state, { draft: elements.assistantInput.value });
  const originalLabel = elements.copyConversationButton.textContent;

  try {
    await copyText(text);
    elements.copyConversationButton.textContent = "Copied";
  } catch {
    elements.copyConversationButton.textContent = "Copy failed";
  } finally {
    window.setTimeout(() => {
      elements.copyConversationButton.textContent = originalLabel;
    }, 1400);
  }
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-999px";
  document.body.append(textarea);
  textarea.select();

  try {
    if (!document.execCommand("copy")) throw new Error("Copy command failed");
  } finally {
    textarea.remove();
  }
}

function updateAssistantStatusFromPlan(plan) {
  elements.assistantStatus.textContent =
    plan.source === "tiny-llm"
      ? `Tiny LLM - ${plan.model}`
      : tinyLlmEnabled && isTinyLlmLoaded()
        ? "Tiny LLM - fallback"
        : "Fallback parser";
}

function snapshotElapsedBeforeSequenceChange() {
  snapshotSessionElapsedBeforeSequenceChange(state);
}

function renderAll() {
  renderIntervals();
  renderAssistantBubble();
  renderPlayer();
}

function renderPlayer() {
  const totalMs = getTotalMs();
  let elapsedMs = getElapsedMs();

  if (state.player.status === "running" && elapsedMs >= totalMs && totalMs > 0) {
    state.player.status = "finished";
    state.player.elapsedBeforeStartMs = totalMs;
    state.player.startedAtMs = null;
    elapsedMs = totalMs;
    markDirty();
    playBeep("finished");
  }

  const location = getSegmentAt(elapsedMs);
  const currentTimer = state.timers[location.index];
  const nextTimer = state.timers[location.index + 1];
  const segmentRemainingMs = Math.max(0, currentTimer.seconds * 1000 - location.segmentElapsedMs);
  const totalRemainingMs = Math.max(0, totalMs - elapsedMs);
  const segmentProgress = currentTimer.seconds
    ? location.segmentElapsedMs / (currentTimer.seconds * 1000)
    : 0;

  elements.currentTitle.textContent =
    state.player.status === "finished" ? "Finished" : currentTimer.label;
  elements.nextTitle.textContent = nextTimer ? nextTimer.label : "None";
  elements.timerElapsed.textContent = `Elapsed ${formatClock(elapsedMs)}`;
  elements.timerTime.textContent = formatClock(segmentRemainingMs);
  elements.timerSubtime.textContent = `${formatClock(totalRemainingMs)} total`;
  updateStartPauseControl();

  const color = kindMeta[currentTimer.kind]?.color || kindMeta.other.color;
  elements.timerDial.style.setProperty("--dial-color", color);
  elements.timerDial.style.setProperty("--dial-progress", `${Math.min(1, segmentProgress) * 360}deg`);

  renderTimeline(location.index);

  if (
    state.player.status === "running" &&
    document.visibilityState === "visible" &&
    lastRenderedSegmentIndex !== null &&
    lastRenderedSegmentIndex !== location.index
  ) {
    playBeep(currentTimer.kind);
  }
  lastRenderedSegmentIndex = location.index;
}

function renderIntervals() {
  elements.sequenceSummary.textContent = `${state.timers.length} interval${
    state.timers.length === 1 ? "" : "s"
  }`;

  elements.intervalList.innerHTML = state.timers
    .map((timer, index) => {
      const minutes = Math.floor(timer.seconds / 60);
      const seconds = timer.seconds % 60;
      const kind = kindMeta[timer.kind] || kindMeta.other;
      return `
        <article class="interval-card" data-id="${escapeHtml(timer.id)}" style="--kind-color: ${kind.color}">
          <div class="interval-topline">
            <label class="field-label">
              Label
              <input data-field="label" value="${escapeHtml(timer.label)}" />
            </label>
          </div>
          <div class="interval-duration">
            <label class="field-label">
              Minutes
              <input data-field="minutes" type="number" min="0" max="1440" step="1" value="${minutes}" />
            </label>
            <label class="field-label">
              Seconds
              <input data-field="seconds" type="number" min="0" max="59" step="1" value="${seconds}" />
            </label>
          </div>
          <div class="interval-actions">
            <button class="mini-button" data-action="up" type="button" ${index === 0 ? "disabled" : ""}>Up</button>
            <button class="mini-button" data-action="down" type="button" ${
              index === state.timers.length - 1 ? "disabled" : ""
            }>Down</button>
            <button class="mini-button" data-action="duplicate" type="button">Copy</button>
            <button class="mini-button" data-action="delete" type="button" ${
              state.timers.length === 1 ? "disabled" : ""
            }>Delete</button>
          </div>
        </article>
      `;
    })
    .join("");

}

function updateStartPauseControl() {
  let label = "Start";
  let controlState = "play";

  if (state.player.status === "running") {
    label = "Pause";
    controlState = "pause";
  } else if (state.player.status === "paused") {
    label = "Resume";
  } else if (state.player.status === "finished") {
    label = "Restart";
    controlState = "restart";
  }

  elements.startPauseButton.dataset.controlState = controlState;
  elements.startPauseButton.setAttribute("aria-label", label);
  elements.startPauseButton.title = label;
}

function renderTimeline(activeIndex) {
  const totalSeconds = Math.max(1, state.timers.reduce((total, timer) => total + timer.seconds, 0));
  elements.timeline.innerHTML = state.timers
    .map((timer, index) => {
      const color = kindMeta[timer.kind]?.color || kindMeta.other.color;
      return `<div class="timeline-segment ${
        index === activeIndex ? "active" : ""
      }" title="${escapeHtml(timer.label)}" style="--segment-flex: ${
        timer.seconds / totalSeconds
      }; --segment-color: ${color}"></div>`;
    })
    .join("");
}

function renderAssistantBubble() {
  elements.assistantBubbleText.textContent = assistantBubbleText;
  elements.assistantThinking.hidden = !assistantIsThinking;
  elements.assistantForm.hidden = assistantIsThinking;
  elements.assistantInput.placeholder =
    state.conversation.length > 2
      ? "Add more detail..."
      : "8 min warmup, 8 x 1 min hard / 1 min rest...";
  resizeAssistantInput();
}

function getElapsedMs(now = Date.now()) {
  return getSessionElapsedMs(state, now);
}

function getTotalMs() {
  return getSessionTotalMs(state);
}

function getSegmentAt(elapsedMs) {
  let cursor = 0;
  for (let index = 0; index < state.timers.length; index += 1) {
    const durationMs = state.timers[index].seconds * 1000;
    if (elapsedMs < cursor + durationMs || index === state.timers.length - 1) {
      return {
        index,
        segmentElapsedMs: clampNumber(elapsedMs - cursor, 0, durationMs),
      };
    }
    cursor += durationMs;
  }
  return { index: 0, segmentElapsedMs: 0 };
}

function detectAssistantMode() {
  if (!canUseTinyLlm()) {
    elements.assistantStatus.textContent = `${ASSISTANT_NAME} - fallback parser`;
    return;
  }
  elements.assistantStatus.textContent = `${ASSISTANT_NAME} - ${getPlannerStatus()}`;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let refreshing = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker
    .register("./service-worker.js", { updateViaCache: "none" })
    .then((registration) => {
      if (registration.waiting) {
        registration.waiting.postMessage({ type: "SKIP_WAITING" });
      }
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            worker.postMessage({ type: "SKIP_WAITING" });
          }
        });
      });
      registration.update().catch(() => {});
    })
    .catch(() => {});
}

function unlockAudio() {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  if (audioContext.state === "suspended") {
    audioContext.resume().catch(() => {});
  }
}

function playBeep(kind) {
  if (!audioContext || audioContext.state !== "running") return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const frequency = kind === "rest" ? 660 : kind === "finished" ? 440 : 880;
  oscillator.frequency.value = frequency;
  oscillator.type = "sine";
  gain.gain.setValueAtTime(0.001, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.14, audioContext.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.18);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.2);
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export const timeyTestApi = {
  createAssistantReply,
  defaultState,
  formatClock,
  getElapsedMs,
  getSegmentAt,
  getWorkoutShape,
  normalizePrompt,
  planWithRules: planWithFallback,
};
