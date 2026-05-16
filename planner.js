import { getWorkoutShape, planWithFallback } from "./fallback-planner.js";
import { getTinyLlmStatus, planWithTinyLlm } from "./llm-planner.js";

export async function planTimers({
  text,
  currentTimers,
  conversation,
  onStatus,
  useTinyLlm = false,
  planWithTinyLlmImpl = planWithTinyLlm,
}) {
  const currentWorkoutShape = getWorkoutShape(currentTimers);

  if (useTinyLlm) {
    try {
      const plan = await planWithTinyLlmImpl({
        text,
        currentTimers,
        currentWorkoutShape,
        conversation,
        onStatus,
      });
      return { ...plan, currentWorkoutShape };
    } catch (error) {
      if (!isNoLlmFallbackError(error)) {
        throw error;
      }
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

function getFallbackResult(text, currentTimers, conversation) {
  try {
    return { plan: planWithFallback(text, currentTimers, conversation), error: null };
  } catch (error) {
    return { plan: null, error };
  }
}

function isNoLlmFallbackError(error) {
  const message = String(error?.message || error || "");
  return /WebGPU unavailable|Tiny LLM not loaded|Tiny LLM unavailable|Could not load|Failed to fetch|NetworkError/i.test(
    message,
  );
}
