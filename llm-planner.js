import { MAX_INTERVALS, isCorrection, normalizePrompt } from "./fallback-planner.js";

export const WEBLLM_PACKAGE_VERSION = "0.2.83";
export const PREFERRED_MODEL_ID = "Qwen2-0.5B-Instruct-q4f16_1-MLC";
export const FALLBACK_MODEL_ID = "Llama-3.2-1B-Instruct-q4f16_1-MLC";
export const WEBLLM_CDN_URL = `https://esm.run/@mlc-ai/web-llm@${WEBLLM_PACKAGE_VERSION}`;
const MODEL_CANDIDATES = [
  PREFERRED_MODEL_ID,
  FALLBACK_MODEL_ID,
];

const timerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["timers"],
  properties: {
    timers: {
      type: "array",
      minItems: 1,
      maxItems: MAX_INTERVALS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "durationSeconds", "kind"],
        properties: {
          label: { type: "string", minLength: 1, maxLength: 48 },
          durationSeconds: { type: "integer", minimum: 1, maximum: 86400 },
          kind: { enum: ["warmup", "work", "rest", "cooldown", "other"] },
        },
      },
    },
  },
};

let webllmModulePromise = null;
let enginePromise = null;
let selectedModelId = null;

export function canUseTinyLlm() {
  return Boolean(globalThis.navigator?.gpu);
}

export function getTinyLlmStatus() {
  if (!canUseTinyLlm()) return "WebGPU unavailable";
  if (selectedModelId && enginePromise) return selectedModelId;
  return "Tiny LLM ready";
}

export function isTinyLlmLoaded() {
  return Boolean(enginePromise && selectedModelId);
}

export function getTinyLlmAssetKey(modelId = selectedModelId || PREFERRED_MODEL_ID) {
  return `${WEBLLM_PACKAGE_VERSION}:${modelId}`;
}

export async function preloadTinyLlm(onStatus) {
  await getEngine(onStatus);
  return selectedModelId;
}

export async function planWithTinyLlm({
  text,
  currentTimers,
  currentWorkoutShape,
  conversation,
  onStatus,
}) {
  if (!canUseTinyLlm()) {
    throw new Error("WebGPU unavailable");
  }
  if (!isTinyLlmLoaded()) {
    throw new Error("Tiny LLM not loaded");
  }

  const engine = await getEngine(onStatus);
  const messages = buildTinyLlmMessages({
    text,
    currentTimers,
    currentWorkoutShape,
    conversation,
  });

  const completion = await engine.chat.completions.create({
    messages,
    temperature: 0,
    max_tokens: 2400,
    response_format: {
      type: "json_object",
      schema: JSON.stringify(timerSchema),
    },
  });
  const content = completion.choices?.[0]?.message?.content;
  if (!content) throw new Error("Tiny LLM returned an empty response");

  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed.timers) || !parsed.timers.length) {
    throw new Error("Tiny LLM returned no timers");
  }

  return {
    timers: validateLlmTimers(parsed.timers),
    model: selectedModelId,
    source: "tiny-llm",
  };
}

export function buildTinyLlmMessages({
  text,
  currentTimers = [],
  currentWorkoutShape = null,
  conversation = [],
}) {
  const correctionRequest = isCorrection(normalizePrompt(text));
  const payload = {
    schema: timerSchema,
    correctionRequest,
    userRequest: text,
  };

  if (correctionRequest) {
    payload.conversation = conversation.slice(-8);
    payload.currentWorkoutShape = currentWorkoutShape;
    payload.currentTimers = currentTimers.map(({ label, seconds, kind }) => ({
      label,
      durationSeconds: seconds,
      kind,
    }));
  }

  return [
    {
      role: "system",
      content: [
        "You convert natural-language workout timer requests into strict JSON.",
        "Return only JSON matching this shape: {\"timers\":[{\"label\":\"Warmup\",\"durationSeconds\":480,\"kind\":\"warmup\"}]}",
        "For new requests, build timers only from userRequest. Do not copy prior or default timers.",
        "Use currentWorkoutShape and currentTimers only when correctionRequest is true.",
        "Use currentWorkoutShape as the compact source of truth for correction requests.",
        "If the user corrects the middle blocks, preserve warmup/cooldown and the previous alternating block count/order unless explicitly changed.",
        "Do not collapse an existing workout to a single interval unless the user explicitly asks for one interval.",
        "Treat 'warmdown' as cooldown. Treat 'alternating cycles/blocks/rounds' as repeated work/rest or rest/work pairs.",
        "Treat 'alternations' and common typos like 'alterations' as repeated work/rest or rest/work pairs. Treat low intensity/easy as rest.",
        "Treat steps, intervals, and timers as individual intervals, not pairs. Exactly 6 steps in the middle means 6 middle intervals total.",
        "For a new standalone timer list, create exactly the requested timers as kind other; do not copy currentTimers. Example: '5 one minute timers and one 30 second' means five 60-second timers plus one 30-second timer.",
        "If the user says N alternating blocks of 1 minute rest and 1 minute work, create N rest intervals and N work intervals between warmup and cooldown.",
        "Duration wording near cycles, blocks, or 'each' usually applies to every middle interval, not to the number of cycles.",
      ].join(" "),
    },
    {
      role: "user",
      content: JSON.stringify(payload),
    },
  ];
}

export function validateLlmTimers(timers) {
  return timers.slice(0, MAX_INTERVALS).map((timer) => {
    const seconds = Number(timer.durationSeconds ?? timer.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) {
      throw new Error("Tiny LLM returned an invalid duration");
    }
    if (!["warmup", "work", "rest", "cooldown", "other"].includes(timer.kind)) {
      throw new Error("Tiny LLM returned an invalid interval kind");
    }
    return {
      label: String(timer.label || "Interval").slice(0, 48),
      seconds,
      kind: timer.kind,
    };
  });
}

async function getEngine(onStatus) {
  if (enginePromise) return enginePromise;
  enginePromise = createEngine(onStatus);
  return enginePromise;
}

async function createEngine(onStatus) {
  onStatus?.("Loading tiny LLM", 0);
  const webllm = await getWebLlmModule();
  selectedModelId = selectModelId(webllm);
  onStatus?.(`Loading ${selectedModelId}`, 0);
  return webllm.CreateMLCEngine(selectedModelId, {
    initProgressCallback: (progress) => {
      const text = progress?.text || progress?.progress ? String(progress.text || "") : "";
      const value = Number(progress?.progress);
      if (text || Number.isFinite(value)) onStatus?.(text || "Loading tiny LLM", value);
    },
  });
}

async function getWebLlmModule() {
  webllmModulePromise ??= import(WEBLLM_CDN_URL);
  return webllmModulePromise;
}

export function selectModelId(webllm) {
  const modelIds = new Set(
    webllm.prebuiltAppConfig?.model_list?.map((model) => model.model_id) || [],
  );
  return MODEL_CANDIDATES.find((modelId) => modelIds.has(modelId)) ?? FALLBACK_MODEL_ID;
}
