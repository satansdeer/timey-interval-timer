import { getWorkoutShape, normalizePrompt, planWithFallback } from "./fallback-planner.js";
import { getTinyLlmStatus, planWithTinyLlm } from "./llm-planner.js";

export async function planTimers({ text, currentTimers, conversation, onStatus, useTinyLlm = false }) {
  const currentWorkoutShape = getWorkoutShape(currentTimers);

  if (useTinyLlm) {
    try {
      const plan = await planWithTinyLlm({
        text,
        currentTimers,
        currentWorkoutShape,
        conversation,
        onStatus,
      });
      return { ...plan, currentWorkoutShape };
    } catch (error) {
      const fallbackResult = getFallbackResult(text, currentTimers, conversation);
      if (!fallbackResult.plan) {
        throw error;
      }
      return {
        ...fallbackResult.plan,
        currentWorkoutShape,
        fallbackReason: error?.message || "Tiny LLM unavailable",
      };
    }
  }

  const fallbackResult = getFallbackResult(text, currentTimers, conversation);
  if (fallbackResult.plan) {
    return {
      ...fallbackResult.plan,
      currentWorkoutShape,
      fallbackReason: "Tiny LLM disabled",
    };
  }
  throw fallbackResult.error;
}

export function getPlannerStatus() {
  return getTinyLlmStatus();
}

export function shouldUseFallbackPlan(text, llmPlan, fallbackPlan) {
  if (!fallbackPlan?.timers?.length || !llmPlan?.timers?.length) return false;
  if (!hasExplicitAlternatingShape(text) && !hasMiddleCountAdjustment(text)) return false;

  const fallbackShape = getWorkoutShape(fallbackPlan.timers);
  const llmShape = getWorkoutShape(llmPlan.timers);
  if (fallbackShape.middle.cycleCount < 2) return false;

  const llmDroppedEndpoint =
    (fallbackShape.warmup && !llmShape.warmup) || (fallbackShape.cooldown && !llmShape.cooldown);
  const middleCountMismatch =
    fallbackShape.middle.intervalCount >= 4 &&
    llmShape.middle.intervalCount !== fallbackShape.middle.intervalCount;
  const totalCountMismatch =
    fallbackShape.intervalCount >= 6 && llmShape.intervalCount !== fallbackShape.intervalCount;
  const durationMismatch =
    fallbackShape.middle.workDurationsSeconds.length === 1 &&
    fallbackShape.middle.restDurationsSeconds.length === 1 &&
    (llmShape.middle.workDurationsSeconds.some(
      (seconds) => seconds !== fallbackShape.middle.workDurationsSeconds[0],
    ) ||
      llmShape.middle.restDurationsSeconds.some(
        (seconds) => seconds !== fallbackShape.middle.restDurationsSeconds[0],
      ));

  return llmDroppedEndpoint || middleCountMismatch || totalCountMismatch || durationMismatch;
}

function hasExplicitAlternatingShape(text) {
  const normalized = normalizePrompt(text);
  return (
    /\d+\s*(?:alternating|alterating|alternate|blocks?|rounds?|cycles?|steps?|sets?)/.test(
      normalized,
    ) &&
    /(rest|recovery|easy)/.test(normalized) &&
    /(work|intensity|hard)/.test(normalized)
  );
}

function hasMiddleCountAdjustment(text) {
  const normalized = normalizePrompt(text);
  return /(too many|too few|twice as little|twice less|half as many|half the|halve|fewer|less|double|twice as many)/.test(
    normalized,
  );
}

function getFallbackResult(text, currentTimers, conversation) {
  try {
    return { plan: planWithFallback(text, currentTimers, conversation), error: null };
  } catch (error) {
    return { plan: null, error };
  }
}
