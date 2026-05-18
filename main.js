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
  decodeTimerSequence,
  defaultState,
  encodeTimerSequence,
  formatClock,
  formatConversationForCopy,
  getElapsedMs as getSessionElapsedMs,
  getTotalMs as getSessionTotalMs,
  normalizePlayer,
  normalizeTimers,
  SHARE_SEQUENCE_QUERY_PARAM,
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
const MODEL_ASSET_KEY = "timey-model-asset-key-v1";

const elements = {
  saveState: document.querySelector("#saveState"),
  installButton: document.querySelector("#installButton"),
  shareWorkoutButton: document.querySelector("#shareWorkoutButton"),
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
  segmentedRing: document.querySelector("#segmentedRing"),
  sequenceSummary: document.querySelector("#sequenceSummary"),
  addIntervalButton: document.querySelector("#addIntervalButton"),
  intervalList: document.querySelector("#intervalList"),
  intervalProperties: document.querySelector("#intervalProperties"),
  sequenceActionButtons: Array.from(document.querySelectorAll("[data-selected-action]")),
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
  tabButtons: Array.from(document.querySelectorAll("[data-tab-target]")),
  tabPanels: Array.from(document.querySelectorAll("[data-tab-panel]")),
};

const kindMeta = KIND_META;
const RING_SEGMENT_COUNT = 48;

let initialShareStatus = null;
let state = loadState();
let selectedTimerId = state.timers[0]?.id || null;
let deferredInstallPrompt = null;
let lastRenderedSegmentIndex = null;
let audioContext = null;
let tinyLlmEnabled = false;
let modelLoadPromise = null;
let assistantIsThinking = false;
let assistantBubbleText = INITIAL_ASSISTANT_BUBBLE_TEXT;
let activeTimelinePointerId = null;
let activeTimelineTouchId = null;

init();

function init() {
  bindEvents();
  registerServiceWorker();
  detectAssistantMode();
  Promise.resolve(startTinyLlmLoad()).catch(() => {});
  if (initialShareStatus) persist();
  renderAll();
  syncAssistantLayoutReserve();
  window.setInterval(renderPlayer, 250);
}

function loadState() {
  const sharedTimers = getSharedTimersFromUrl();
  if (sharedTimers.length) {
    initialShareStatus = "Loaded shared workout";
    return {
      ...defaultState(),
      timers: sharedTimers,
    };
  }

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
  elements.saveState.textContent = initialShareStatus || "Saved locally";
  initialShareStatus = null;
}

function markDirty() {
  elements.saveState.textContent = "Saving...";
  persist();
  syncSharedUrlIfPresent();
}

function getSharedTimersFromUrl() {
  try {
    const url = new URL(window.location.href);
    return decodeTimerSequence(url.searchParams.get(SHARE_SEQUENCE_QUERY_PARAM));
  } catch {
    return [];
  }
}

function createShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set(SHARE_SEQUENCE_QUERY_PARAM, encodeTimerSequence(state.timers));
  return url.toString();
}

function syncSharedUrlIfPresent() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SHARE_SEQUENCE_QUERY_PARAM)) return;
    url.searchParams.set(SHARE_SEQUENCE_QUERY_PARAM, encodeTimerSequence(state.timers));
    replaceUrl(url.toString());
  } catch {
    // URL sharing should not block timer edits or playback controls.
  }
}

function removeSharedSequenceFromUrl() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(SHARE_SEQUENCE_QUERY_PARAM)) return;
    url.searchParams.delete(SHARE_SEQUENCE_QUERY_PARAM);
    replaceUrl(url.toString());
  } catch {
    // Reset still works if the History API is unavailable.
  }
}

function replaceUrl(url) {
  window.history.replaceState(null, "", url);
}

function bindEvents() {
  elements.startPauseButton.addEventListener("click", toggleStartPause);
  elements.stopButton.addEventListener("click", stopTimer);
  elements.previousButton.addEventListener("click", previousInterval);
  elements.nextButton.addEventListener("click", nextInterval);
  elements.timeline.addEventListener("pointerdown", handleTimelinePointerDown);
  elements.timeline.addEventListener("lostpointercapture", handleTimelineLostPointerCapture);
  elements.timeline.addEventListener("touchstart", handleTimelineTouchStart, { passive: false });
  document.addEventListener("pointermove", handleTimelinePointerMove);
  document.addEventListener("pointerup", handleTimelinePointerUp);
  document.addEventListener("pointercancel", handleTimelinePointerCancel);
  document.addEventListener("touchmove", handleTimelineTouchMove, { passive: false });
  document.addEventListener("touchend", handleTimelineTouchEnd, { passive: false });
  document.addEventListener("touchcancel", handleTimelineTouchCancel, { passive: false });
  elements.timeline.addEventListener("keydown", handleTimelineKeydown);
  elements.addIntervalButton.addEventListener("click", addInterval);
  elements.shareWorkoutButton.addEventListener("click", handleShareWorkout);
  elements.resetDataButton.addEventListener("click", resetData);
  elements.intervalList.addEventListener("click", handleIntervalSelection);
  elements.intervalList.addEventListener("keydown", handleIntervalListKeydown);
  elements.intervalProperties.addEventListener("change", handleIntervalInput);
  elements.sequenceActionButtons.forEach((button) => {
    button.addEventListener("click", handleSelectedIntervalAction);
  });
  elements.assistantToggleButton.addEventListener("click", toggleAssistantPopover);
  elements.assistantCloseButton.addEventListener("click", closeAssistantPopover);
  elements.assistantForm.addEventListener("submit", handleAssistantSubmit);
  elements.assistantInput.addEventListener("input", resizeAssistantInput);
  elements.assistantInput.addEventListener("keydown", handleAssistantKeydown);
  elements.copyConversationButton.addEventListener("click", handleCopyConversation);
  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tabTarget));
    button.addEventListener("keydown", handleTabKeydown);
  });

  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("visibilitychange", () => {
    renderPlayer();
    persist();
  });

  window.addEventListener("resize", syncAssistantLayoutReserve);
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

function activateTab(panelId, shouldFocus = false) {
  const activeButton = elements.tabButtons.find((button) => button.dataset.tabTarget === panelId);
  if (!activeButton) return;

  elements.tabButtons.forEach((button) => {
    const isActive = button === activeButton;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  elements.tabPanels.forEach((panel) => {
    panel.hidden = panel.id !== panelId;
  });

  if (shouldFocus) activeButton.focus();
}

function handleTabKeydown(event) {
  const navigationKeys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!navigationKeys.includes(event.key)) return;

  event.preventDefault();
  const currentIndex = elements.tabButtons.indexOf(event.currentTarget);
  const lastIndex = elements.tabButtons.length - 1;
  let nextIndex = currentIndex;

  if (event.key === "ArrowLeft") nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
  if (event.key === "ArrowRight") nextIndex = currentIndex >= lastIndex ? 0 : currentIndex + 1;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = lastIndex;

  activateTab(elements.tabButtons[nextIndex].dataset.tabTarget, true);
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
  seekToElapsedMs(elapsedBefore);
}

function seekToElapsedMs(elapsedMs) {
  const totalMs = getTotalMs();
  const targetElapsedMs = clampNumber(elapsedMs, 0, totalMs);
  const shouldFinish = totalMs > 0 && targetElapsedMs >= totalMs;

  state.player.elapsedBeforeStartMs = targetElapsedMs;
  state.player.startedAtMs =
    state.player.status === "running" && !shouldFinish ? Date.now() : null;

  if (shouldFinish) {
    state.player.status = "finished";
  } else if (state.player.status === "finished") {
    state.player.status = "paused";
  }

  lastRenderedSegmentIndex = getSegmentAt(targetElapsedMs).index;
  markDirty();
  renderAll();
}

function handleTimelinePointerDown(event) {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
  activeTimelinePointerId = event.pointerId;
  event.currentTarget.setPointerCapture?.(event.pointerId);
  event.preventDefault();
  seekToTimelinePoint(event.clientX);
}

function handleTimelinePointerMove(event) {
  if (event.pointerId !== activeTimelinePointerId) return;
  event.preventDefault();
  seekToTimelinePoint(event.clientX);
}

function handleTimelinePointerUp(event) {
  if (event.pointerId !== activeTimelinePointerId) return;
  event.preventDefault();
  seekToTimelinePoint(event.clientX);
  endTimelinePointerDrag(elements.timeline, event.pointerId);
}

function handleTimelinePointerCancel(event) {
  if (event.pointerId !== activeTimelinePointerId) return;
  endTimelinePointerDrag(elements.timeline, event.pointerId);
}

function handleTimelineLostPointerCapture(event) {
  if (event.pointerId === activeTimelinePointerId) activeTimelinePointerId = null;
}

function endTimelinePointerDrag(target, pointerId) {
  if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
  activeTimelinePointerId = null;
}

function handleTimelineTouchStart(event) {
  if (activeTimelineTouchId !== null || !event.changedTouches.length) return;
  const touch = event.changedTouches[0];
  activeTimelineTouchId = touch.identifier;
  event.preventDefault();
  seekToTimelinePoint(touch.clientX);
}

function handleTimelineTouchMove(event) {
  if (activeTimelineTouchId === null) return;
  const touch = getActiveTimelineTouch(event.touches);
  if (!touch) return;
  event.preventDefault();
  seekToTimelinePoint(touch.clientX);
}

function handleTimelineTouchEnd(event) {
  if (activeTimelineTouchId === null) return;
  const touch = getActiveTimelineTouch(event.changedTouches);
  if (touch) {
    event.preventDefault();
    seekToTimelinePoint(touch.clientX);
    activeTimelineTouchId = null;
  }
}

function handleTimelineTouchCancel(event) {
  if (activeTimelineTouchId === null) return;
  if (getActiveTimelineTouch(event.changedTouches)) activeTimelineTouchId = null;
}

function getActiveTimelineTouch(touches) {
  return Array.from(touches).find((touch) => touch.identifier === activeTimelineTouchId) || null;
}

function seekToTimelinePoint(clientX) {
  seekToElapsedMs(getElapsedMsAtTimelinePoint(clientX));
}

function getElapsedMsAtTimelinePoint(clientX) {
  const totalMs = getTotalMs();
  if (totalMs <= 0) return 0;

  const segments = Array.from(elements.timeline.querySelectorAll(".timeline-segment"));
  if (!segments.length) return 0;

  let cursorMs = 0;
  let previousRight = null;
  let previousElapsedMs = 0;

  for (let index = 0; index < segments.length; index += 1) {
    const timer = state.timers[index];
    const durationMs = timer.seconds * 1000;
    const range = getTimelineSegmentRange(segments[index]);

    if (clientX < range.left) {
      if (previousRight === null) return 0;
      return clientX < previousRight + (range.left - previousRight) / 2
        ? previousElapsedMs
        : cursorMs;
    }

    if (clientX <= range.right) {
      const progress = clampNumber((clientX - range.left) / range.width, 0, 1);
      return cursorMs + durationMs * progress;
    }

    cursorMs += durationMs;
    previousRight = range.right;
    previousElapsedMs = cursorMs;
  }

  return totalMs;
}

function getTimelineSegmentRange(segment) {
  const rect = segment.getBoundingClientRect();
  const styles = window.getComputedStyle(segment);
  const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(styles.borderRightWidth) || 0;
  const left = rect.left + borderLeft;
  return {
    left,
    right: rect.right - borderRight,
    width: Math.max(1, rect.width - borderLeft - borderRight),
  };
}

function handleTimelineKeydown(event) {
  const totalMs = getTotalMs();
  if (totalMs <= 0) return;

  const elapsedMs = getElapsedMs();
  const smallStepMs = 5000;
  const largeStepMs = 30000;
  let targetElapsedMs = null;

  if (event.key === "Home") targetElapsedMs = 0;
  if (event.key === "End") targetElapsedMs = totalMs;
  if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
    targetElapsedMs = elapsedMs - smallStepMs;
  }
  if (event.key === "ArrowRight" || event.key === "ArrowUp") {
    targetElapsedMs = elapsedMs + smallStepMs;
  }
  if (event.key === "PageDown") targetElapsedMs = elapsedMs - largeStepMs;
  if (event.key === "PageUp") targetElapsedMs = elapsedMs + largeStepMs;

  if (targetElapsedMs === null) return;
  event.preventDefault();
  seekToElapsedMs(targetElapsedMs);
}

function addInterval() {
  snapshotElapsedBeforeSequenceChange();
  const timer = createTimer("Work", 60, "work");
  state.timers.push(timer);
  selectedTimerId = timer.id;
  markDirty();
  renderAll();
}

function resetData() {
  state = defaultState();
  assistantIsThinking = false;
  tinyLlmEnabled = isTinyLlmLoaded();
  assistantBubbleText = INITIAL_ASSISTANT_BUBBLE_TEXT;
  elements.assistantInput.value = "";
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem(MODEL_ASSET_KEY);
  localStorage.removeItem(LEGACY_MODEL_CHOICE_KEY);
  localStorage.removeItem("timey-model-choice-v1");
  lastRenderedSegmentIndex = null;
  selectedTimerId = state.timers[0]?.id || null;
  removeSharedSequenceFromUrl();
  updateAssistantStatusForModelPreference();
  persist();
  renderAll();
}

async function handleShareWorkout() {
  const originalLabel = elements.shareWorkoutButton.textContent;
  const shareUrl = createShareUrl();
  replaceUrl(shareUrl);

  try {
    if (navigator.share) {
      await navigator.share({
        title: "Timey workout",
        text: "Timey workout sequence",
        url: shareUrl,
      });
      elements.shareWorkoutButton.textContent = "Shared";
      elements.saveState.textContent = "Share complete";
    } else {
      await copyText(shareUrl);
      elements.shareWorkoutButton.textContent = "Copied";
      elements.saveState.textContent = "Share link copied";
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    try {
      await copyText(shareUrl);
      elements.shareWorkoutButton.textContent = "Copied";
      elements.saveState.textContent = "Share link copied";
    } catch {
      elements.shareWorkoutButton.textContent = "Share failed";
      elements.saveState.textContent = "Could not copy share link";
    }
  } finally {
    window.setTimeout(() => {
      elements.shareWorkoutButton.textContent = originalLabel;
    }, 1400);
  }
}

function handleIntervalInput(event) {
  const timer = getSelectedTimer();
  if (!timer) return;

  snapshotElapsedBeforeSequenceChange();

  if (event.target.matches("[data-field='label']")) {
    timer.label = event.target.value.trim().slice(0, 48) || kindMeta[timer.kind].label;
    timer.kind = inferKind(timer.label);
  }

  if (event.target.matches("[data-field='minutes'], [data-field='seconds']")) {
    const minutes = Number(elements.intervalProperties.querySelector("[data-field='minutes']").value) || 0;
    const seconds = Number(elements.intervalProperties.querySelector("[data-field='seconds']").value) || 0;
    timer.seconds = clampInteger(minutes * 60 + seconds, 1, 86400);
  }

  markDirty();
  renderAll();
}

function handleIntervalSelection(event) {
  const row = event.target.closest("[data-id]");
  if (!row) return;
  selectedTimerId = row.dataset.id;
  renderIntervals();
}

function handleIntervalListKeydown(event) {
  if (!["ArrowUp", "ArrowDown", "Home", "End", "Enter"].includes(event.key)) return;
  const index = getSelectedTimerIndex();
  if (index < 0) return;

  if (event.key === "Enter") {
    event.preventDefault();
    elements.intervalProperties.querySelector("[data-field='label']")?.focus();
    return;
  }

  event.preventDefault();
  let nextIndex = index;
  if (event.key === "ArrowUp") nextIndex = Math.max(0, index - 1);
  if (event.key === "ArrowDown") nextIndex = Math.min(state.timers.length - 1, index + 1);
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = state.timers.length - 1;

  selectedTimerId = state.timers[nextIndex]?.id || selectedTimerId;
  renderIntervals();
  elements.intervalList.querySelector(`[data-id="${CSS.escape(selectedTimerId)}"]`)?.focus();
}

function handleSelectedIntervalAction(event) {
  const action = event.currentTarget.dataset.selectedAction;
  const index = getSelectedTimerIndex();
  if (index < 0) return;

  snapshotElapsedBeforeSequenceChange();

  if (action === "up" && index > 0) {
    [state.timers[index - 1], state.timers[index]] = [state.timers[index], state.timers[index - 1]];
  }

  if (action === "down" && index < state.timers.length - 1) {
    [state.timers[index + 1], state.timers[index]] = [state.timers[index], state.timers[index + 1]];
  }

  if (action === "duplicate") {
    const timer = state.timers[index];
    const copy = createTimer(`${timer.label} copy`, timer.seconds, timer.kind);
    state.timers.splice(index + 1, 0, copy);
    selectedTimerId = copy.id;
  }

  if (action === "delete" && state.timers.length > 1) {
    state.timers.splice(index, 1);
    selectedTimerId = state.timers[Math.min(index, state.timers.length - 1)]?.id || null;
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
  syncAssistantLayoutReserve();

  window.requestAnimationFrame(() => {
    resizeAssistantInput();
    syncAssistantLayoutReserve();
    if (focusInput) elements.assistantInput.focus({ preventScroll: true });
  });
}

function closeAssistantPopover() {
  elements.assistantPopover.hidden = true;
  elements.assistantToggleButton.setAttribute("aria-expanded", "false");
  elements.assistantToggleButton.setAttribute("aria-label", "Open Timmy assistant");
  elements.assistantToggleButton.title = "Timmy";
  syncAssistantLayoutReserve();
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape") return;
  if (!elements.assistantPopover.hidden) {
    closeAssistantPopover();
    elements.assistantToggleButton.focus({ preventScroll: true });
  }
}

function resizeAssistantInput() {
  elements.assistantInput.style.height = "auto";
  elements.assistantInput.style.height = `${Math.min(elements.assistantInput.scrollHeight, 136)}px`;
  syncAssistantLayoutReserve();
}

function updateAssistantStatusForModelPreference() {
  if (tinyLlmEnabled && isTinyLlmLoaded()) {
    elements.assistantStatus.textContent = `Tiny model - ${getPlannerStatus()}`;
    return;
  }
  elements.assistantStatus.textContent = `${ASSISTANT_NAME} - fallback parser`;
}

async function startTinyLlmLoad() {
  localStorage.removeItem("timey-model-choice-v1");
  localStorage.removeItem(LEGACY_MODEL_CHOICE_KEY);

  if (!canUseTinyLlm()) {
    tinyLlmEnabled = false;
    updateAssistantStatusForModelPreference();
    return;
  }
  if (isTinyLlmLoaded()) {
    tinyLlmEnabled = true;
    updateAssistantStatusForModelPreference();
    return;
  }
  if (modelLoadPromise) return modelLoadPromise;

  tinyLlmEnabled = false;
  elements.assistantStatus.textContent = "Loading tiny timer model";

  modelLoadPromise = preloadTinyLlm((status, progress) => {
    elements.assistantStatus.textContent = formatInlineModelStatus(status, progress);
  })
    .then((modelId) => {
      tinyLlmEnabled = true;
      localStorage.setItem(MODEL_ASSET_KEY, getTinyLlmAssetKey(modelId));
      updateAssistantStatusForModelPreference();
      return modelId;
    })
    .catch((error) => {
      tinyLlmEnabled = false;
      updateAssistantStatusForModelPreference();
      console.warn("Tiny timer model failed to load; using fallback parser.", error);
      modelLoadPromise = null;
      throw error;
    });

  return modelLoadPromise;
}

function formatInlineModelStatus(status, progress) {
  if (Number.isFinite(progress) && progress > 0 && progress < 1) {
    return `Loading tiny timer model - ${Math.round(progress * 100)}%`;
  }
  if (/finish|ready|loaded/i.test(status)) return `Tiny model - ${getPlannerStatus()}`;
  return status || "Loading tiny timer model";
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
    if (canUseTinyLlm() && !isTinyLlmLoaded()) {
      await startTinyLlmLoad().catch(() => {});
    }
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
      ? `Tiny model - ${plan.model}`
      : tinyLlmEnabled && isTinyLlmLoaded()
        ? "Tiny model - fallback"
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
  elements.timerDial.style.setProperty("--dial-progress-percent", `${Math.min(1, segmentProgress) * 100}%`);
  renderSegmentedRing(segmentProgress, color);

  renderTimeline(location.index, elapsedMs, totalMs);

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
  const selectedIndex = ensureSelectedTimer();
  elements.sequenceSummary.textContent = `${state.timers.length} interval${
    state.timers.length === 1 ? "" : "s"
  }`;

  elements.intervalList.innerHTML = `
    <div class="listview-header" role="row">
      <div class="listview-cell listview-number">#</div>
      <div class="listview-cell">Label</div>
      <div class="listview-cell">Duration</div>
      <div class="listview-cell">Kind</div>
    </div>
    <div class="listview-body" role="grid" aria-rowcount="${state.timers.length}">
      ${state.timers
        .map((timer, index) => {
          const kind = kindMeta[timer.kind] || kindMeta.other;
          const isSelected = index === selectedIndex;
          return `
            <div
              class="listview-row ${isSelected ? "selected" : ""}"
              data-id="${escapeHtml(timer.id)}"
              role="row"
              aria-selected="${isSelected}"
              tabindex="${isSelected ? "0" : "-1"}"
              style="--kind-color: ${kind.color}"
            >
              <div class="listview-cell listview-number">${index + 1}</div>
              <div class="listview-cell listview-label">
                <span class="kind-swatch" aria-hidden="true"></span>
                <span>${escapeHtml(timer.label)}</span>
              </div>
              <div class="listview-cell">${formatDurationLabel(timer.seconds)}</div>
              <div class="listview-cell">${escapeHtml(kind.label)}</div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;

  renderIntervalProperties(selectedIndex);
  updateSequenceActionControls(selectedIndex);
}

function renderIntervalProperties(selectedIndex) {
  const timer = state.timers[selectedIndex];
  if (!timer) {
    elements.intervalProperties.innerHTML = "";
    return;
  }

  const minutes = Math.floor(timer.seconds / 60);
  const seconds = timer.seconds % 60;
  const kind = kindMeta[timer.kind] || kindMeta.other;
  elements.intervalProperties.innerHTML = `
    <fieldset class="property-group">
      <legend>Interval properties</legend>
      <div class="property-grid">
        <label class="field-label property-label">
          Label
          <input data-field="label" value="${escapeHtml(timer.label)}" />
        </label>
        <label class="field-label numeric-field">
          Minutes
          <input data-field="minutes" type="number" min="0" max="1440" step="1" value="${minutes}" />
        </label>
        <label class="field-label numeric-field">
          Seconds
          <input data-field="seconds" type="number" min="0" max="59" step="1" value="${seconds}" />
        </label>
        <div class="field-label kind-readout">
          Kind
          <div class="kind-value" style="--kind-color: ${kind.color}">
            <span class="kind-swatch" aria-hidden="true"></span>
            <span>${escapeHtml(kind.label)}</span>
          </div>
        </div>
      </div>
    </fieldset>
  `;
}

function updateSequenceActionControls(selectedIndex) {
  elements.sequenceActionButtons.forEach((button) => {
    const action = button.dataset.selectedAction;
    button.disabled =
      selectedIndex < 0 ||
      (action === "up" && selectedIndex === 0) ||
      (action === "down" && selectedIndex === state.timers.length - 1) ||
      (action === "delete" && state.timers.length === 1);
  });
}

function ensureSelectedTimer() {
  let index = getSelectedTimerIndex();
  if (index >= 0) return index;
  selectedTimerId = state.timers[0]?.id || null;
  index = getSelectedTimerIndex();
  return index;
}

function getSelectedTimerIndex() {
  return state.timers.findIndex((timer) => timer.id === selectedTimerId);
}

function getSelectedTimer() {
  return state.timers[getSelectedTimerIndex()] || null;
}

function formatDurationLabel(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!seconds) return `${minutes} min`;
  if (!minutes) return `${seconds} sec`;
  return `${minutes} min ${seconds} sec`;
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

function renderSegmentedRing(segmentProgress, color) {
  const filledSegments = Math.round(clampNumber(segmentProgress, 0, 1) * RING_SEGMENT_COUNT);
  elements.segmentedRing.innerHTML = Array.from({ length: RING_SEGMENT_COUNT }, (_, index) => {
    const isFilled = index < filledSegments;
    return `<span class="ring-segment ${isFilled ? "filled" : ""}" style="--ring-index: ${index}; --ring-color: ${color}"></span>`;
  }).join("");
}

function renderTimeline(activeIndex, elapsedMs, totalMs) {
  const totalSeconds = Math.max(1, state.timers.reduce((total, timer) => total + timer.seconds, 0));
  let cursorSeconds = 0;
  const elapsedSeconds = elapsedMs / 1000;
  elements.timeline.setAttribute("aria-valuemax", String(Math.round(totalMs / 1000)));
  elements.timeline.setAttribute("aria-valuenow", String(Math.round(elapsedMs / 1000)));
  elements.timeline.setAttribute(
    "aria-valuetext",
    `${formatClock(elapsedMs)} of ${formatClock(totalMs)}`,
  );
  elements.timeline.innerHTML = state.timers
    .map((timer, index) => {
      const color = kindMeta[timer.kind]?.color || kindMeta.other.color;
      const progress = clampNumber((elapsedSeconds - cursorSeconds) / timer.seconds, 0, 1);
      cursorSeconds += timer.seconds;
      return `<div class="timeline-segment ${
        index === activeIndex ? "active" : ""
      }" title="${escapeHtml(timer.label)}" style="--segment-flex: ${
        timer.seconds / totalSeconds
      }; --segment-color: ${color}; --segment-progress: ${progress * 100}%">
        <div class="timeline-segment-fill"></div>
      </div>`;
    })
    .join("") + `<div class="timeline-playhead"></div>`;
  positionTimelinePlayhead(activeIndex);
}

function positionTimelinePlayhead(activeIndex) {
  const playhead = elements.timeline.querySelector(".timeline-playhead");
  const activeSegment = elements.timeline.querySelectorAll(".timeline-segment")[activeIndex];
  const activeFill = activeSegment?.querySelector(".timeline-segment-fill");
  if (!playhead || !activeFill) return;

  const timelineRect = elements.timeline.getBoundingClientRect();
  const timelineStyles = window.getComputedStyle(elements.timeline);
  const borderLeft = Number.parseFloat(timelineStyles.borderLeftWidth) || 0;
  const fillRect = activeFill.getBoundingClientRect();
  playhead.style.left = `${fillRect.right - timelineRect.left - borderLeft}px`;
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
  syncAssistantLayoutReserve();
}

function syncAssistantLayoutReserve() {
  if (!elements.assistantWidget) return;
  const rect = elements.assistantWidget.getBoundingClientRect();
  const bottomGap = Math.max(0, window.innerHeight - rect.bottom);
  const reserveBottom = Math.ceil(rect.height + bottomGap + 10);
  document.documentElement.style.setProperty("--assistant-reserve-bottom", `${reserveBottom}px`);
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
