import { MAX_INTERVALS, extractExplicitGenericTimers, isCorrection, normalizePrompt } from "./fallback-planner.js";
import {
  findTimerDslStartIndex,
  isCompleteTimerDsl,
  isTimerDslHardInvalidPrefix,
  isTimerDslPrefix,
  parseTimerDsl,
} from "./timer-dsl.js";
import {
  buildLosslessItemAtomActionUserContent,
  parseTimerActions,
} from "./scripts/training/timer-sft-lib.mjs";

export const TRANSFORMERS_PACKAGE_VERSION = "4.2.0";
export const TRAINED_TINY_MODEL_ID = "timey-t5-efficient-tiny";
export const TRAINED_TINY_MODEL_VERSION = "phase4y-actions-browser-exact-checkpoint-50-dynq8enc-q4dec-ort-beam4";
export const TRAINED_TINY_MODEL_DTYPE = "dynamic-q8-encoder-q4-decoder-opset21-actions";
export const TRAINED_TINY_MODEL_DEVICE = "wasm";
export const TRANSFORMERS_CDN_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${TRANSFORMERS_PACKAGE_VERSION}`;
export const ONNXRUNTIME_WEB_VERSION = "1.26.0-dev.20260416-b7804b056c";
export const ONNXRUNTIME_WASM_CDN_URL = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNXRUNTIME_WEB_VERSION}/dist/`;
export const ONNXRUNTIME_WASM_ESM_URL = `${ONNXRUNTIME_WASM_CDN_URL}ort.wasm.min.mjs`;
export const ONNXRUNTIME_WASM_PATHS = {
  mjs: `${ONNXRUNTIME_WASM_CDN_URL}ort-wasm-simd-threaded.mjs`,
  wasm: `${ONNXRUNTIME_WASM_CDN_URL}ort-wasm-simd-threaded.wasm`,
};
export const TINY_TIMER_ENCODER_URL = `/models/${TRAINED_TINY_MODEL_ID}/onnx/encoder_model_quantized.onnx`;
export const TINY_TIMER_DECODER_URL = `/models/${TRAINED_TINY_MODEL_ID}/onnx/decoder_model_quantized.onnx`;
export const TINY_TIMER_INPUT_PREFIX = "translate timer request to Timey actions: ";
export const TINY_TIMER_MAX_INPUT_TOKENS = 480;
export const TINY_TIMER_MAX_NEW_TOKENS = 64;
export const TINY_TIMER_NUM_BEAMS = 4;
export const TINY_TIMER_TOPK_PER_BEAM = 8;

let transformersModulePromise = null;
let onnxRuntimeModulePromise = null;
let generatorPromise = null;
let selectedModelId = null;

export function canUseTinyLlm() {
  return typeof globalThis.WebAssembly === "object";
}

export function getTinyLlmStatus() {
  if (!canUseTinyLlm()) return "WebAssembly unavailable";
  if (selectedModelId && generatorPromise) return selectedModelId;
  return "Tiny timer model ready";
}

export function isTinyLlmLoaded() {
  return Boolean(generatorPromise && selectedModelId);
}

export function getTinyLlmAssetKey(modelId = selectedModelId || TRAINED_TINY_MODEL_ID) {
  return `${TRANSFORMERS_PACKAGE_VERSION}:${TRAINED_TINY_MODEL_VERSION}:${modelId}`;
}

export async function preloadTinyLlm(onStatus) {
  await getGenerator(onStatus);
  return selectedModelId;
}

export async function planWithTinyLlm({ text, onStatus }) {
  const directDsl = parseDirectTimerDslInput(text);
  if (directDsl) {
    return {
      timers: directDsl.timers,
      model: selectedModelId || TRAINED_TINY_MODEL_ID,
      rawContent: directDsl.rawContent,
      rawTimers: directDsl.timers,
      source: "tiny-llm",
    };
  }

  if (!canUseTinyLlm()) {
    throw new Error("WebAssembly unavailable");
  }
  if (!isTinyLlmLoaded()) {
    throw new Error("Tiny timer model not loaded");
  }
  if (isCorrection(normalizePrompt(text))) {
    throw new Error("Tiny seq2seq planner does not handle correction requests");
  }

  const runtime = await getGenerator(onStatus);
  const request = buildTinyLlmRequest(text);
  const content = await runtime.generate(request.input, onStatus);
  if (!content) throw new Error("Tiny timer model returned an empty response");

  const parsed = parseTimerActions(content, request.slots, "tiny timer model action output");
  const rawTimers = validateLlmTimers(parsed.timers);
  return {
    timers: rawTimers,
    model: selectedModelId,
    rawContent: content,
    rawTimers,
    source: "tiny-llm",
  };
}

export function parseDirectTimerDslInput(text) {
  const source = String(text || "");
  const start = findTimerDslStartIndex(source);
  if (start < 0) return null;

  const rawContent = source.slice(start);
  const parsed = parseTimerDsl(rawContent, "direct timer DSL input");
  return {
    timers: validateLlmTimers(parsed.timers),
    rawContent,
  };
}

export function repairGenericTimerList(text, modelTimers) {
  const genericTimers = extractExplicitGenericTimers(normalizePrompt(text));
  if (!genericTimers.length) return modelTimers;

  const modelDurations = modelTimers.map((timer) => Number(timer.durationSeconds ?? timer.seconds));
  const genericDurations = genericTimers.map((timer) => Number(timer.durationSeconds ?? timer.seconds));
  const sameGenericTimers =
    modelDurations.length === genericDurations.length &&
    modelDurations.every((seconds, index) => seconds === genericDurations[index]) &&
    modelTimers.every((timer) => timer.kind === "other");
  return sameGenericTimers ? modelTimers : genericTimers;
}

export function buildTinyLlmInput(text) {
  return buildTinyLlmRequest(text).input;
}

export function buildTinyLlmRequest(text) {
  const actionUserContent = buildLosslessItemAtomActionUserContent(String(text || "").trim());
  return {
    input: `${TINY_TIMER_INPUT_PREFIX}${actionUserContent.content}`,
    slots: actionUserContent.slots,
  };
}

export function validateLlmTimers(timers) {
  if (!Array.isArray(timers) || !timers.length) {
    throw new Error("Tiny timer model returned no timers");
  }

  return timers.slice(0, MAX_INTERVALS).map((timer) => {
    const seconds = Number(timer.durationSeconds ?? timer.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 86400) {
      throw new Error("Tiny timer model returned an invalid duration");
    }
    if (!["warmup", "work", "rest", "cooldown", "other"].includes(timer.kind)) {
      throw new Error("Tiny timer model returned an invalid interval kind");
    }
    return {
      label: String(timer.label || "Interval").slice(0, 48),
      seconds,
      kind: timer.kind,
    };
  });
}

async function getGenerator(onStatus) {
  if (generatorPromise) return generatorPromise;
  generatorPromise = createGenerator(onStatus).catch((error) => {
    generatorPromise = null;
    selectedModelId = null;
    throw error;
  });
  return generatorPromise;
}

async function createGenerator(onStatus) {
  onStatus?.("Loading tiny timer model", 0);
  const { AutoTokenizer, env } = await getTransformersModule();

  env.allowLocalModels = true;
  env.allowRemoteModels = false;
  env.localModelPath = "/models/";

  onStatus?.("Loading tiny timer tokenizer", 0.05);
  const tokenizer = await AutoTokenizer.from_pretrained(TRAINED_TINY_MODEL_ID, {
    progress_callback: (progress) => {
      onStatus?.(formatProgressStatus(progress), normalizeProgress(progress) * 0.2);
    },
  });

  onStatus?.("Loading tiny timer runtime", 0.25);
  const ort = await getOnnxRuntimeModule();
  configureOnnxRuntimeWeb(ort.env);

  const sessionOptions = {
    executionProviders: [TRAINED_TINY_MODEL_DEVICE],
    graphOptimizationLevel: "all",
  };
  onStatus?.("Loading tiny timer encoder", 0.35);
  const encoder = await ort.InferenceSession.create(TINY_TIMER_ENCODER_URL, sessionOptions);
  onStatus?.("Loading tiny timer decoder", 0.65);
  const decoder = await ort.InferenceSession.create(TINY_TIMER_DECODER_URL, sessionOptions);

  selectedModelId = TRAINED_TINY_MODEL_ID;
  onStatus?.(`Loaded ${TRAINED_TINY_MODEL_ID}`, 1);
  return {
    generate: (input, statusCallback) =>
      generateWithOrt({
        input,
        tokenizer,
        ort,
        encoder,
        decoder,
        onStatus: statusCallback,
      }),
  };
}

function configureOnnxRuntimeWeb(env) {
  const wasm = env?.wasm;
  if (!wasm) return;

  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = ONNXRUNTIME_WASM_PATHS;
}

async function getTransformersModule() {
  transformersModulePromise ??= import(TRANSFORMERS_CDN_URL);
  return transformersModulePromise;
}

async function getOnnxRuntimeModule() {
  onnxRuntimeModulePromise ??= import(ONNXRUNTIME_WASM_ESM_URL);
  return onnxRuntimeModulePromise;
}

async function generateWithOrt({ input, tokenizer, ort, encoder, decoder, onStatus }) {
  onStatus?.("Encoding timer request", 0.72);
  const encoded = await tokenizer(input, {
    truncation: true,
    max_length: TINY_TIMER_MAX_INPUT_TOKENS,
  });
  const inputIds = encoded.input_ids;
  const attentionMask = encoded.attention_mask;
  const inputDims = inputIds.dims || [1, tensorData(inputIds).length];
  const attentionDims = attentionMask.dims || inputDims;
  const inputTensor = new ort.Tensor("int64", toBigInt64Array(tensorData(inputIds)), inputDims);
  const attentionTensor = new ort.Tensor("int64", toBigInt64Array(tensorData(attentionMask)), attentionDims);

  onStatus?.("Running timer encoder", 0.76);
  const encoderOutputs = await encoder.run({
    input_ids: inputTensor,
    attention_mask: attentionTensor,
  });
  const encoderHiddenStates = encoderOutputs.last_hidden_state || Object.values(encoderOutputs)[0];
  if (!encoderHiddenStates) throw new Error("Tiny timer model returned no encoder state");

  const outputIds = await generateBeamSearch({
    tokenizer,
    ort,
    decoder,
    attentionTensor,
    encoderHiddenStates,
    candidateValidator: null,
    onStatus,
  });

  onStatus?.("Parsing timer plan", 0.99);
  return String(tokenizer.decode(outputIds, { skip_special_tokens: true })).trim();
}

async function generateBeamSearch({ tokenizer, ort, decoder, attentionTensor, encoderHiddenStates, candidateValidator, onStatus }) {
  let beams = [
    {
      ids: [0n],
      outputIds: [],
      score: 0,
      done: false,
      constraintFallback: false,
    },
  ];

  for (let step = 0; step < TINY_TIMER_MAX_NEW_TOKENS; step += 1) {
    if (step === 0 || step % 8 === 0) {
      onStatus?.("Generating timer plan", 0.8 + Math.min(0.18, step / TINY_TIMER_MAX_NEW_TOKENS * 0.18));
    }

    const candidates = [];
    for (const beam of beams) {
      if (beam.done) {
        candidates.push(beam);
        continue;
      }

      const decoderInput = new ort.Tensor("int64", BigInt64Array.from(beam.ids), [1, beam.ids.length]);
      const decoderOutputs = await decoder.run({
        encoder_attention_mask: attentionTensor,
        input_ids: decoderInput,
        encoder_hidden_states: encoderHiddenStates,
      });
      const logits = decoderOutputs.logits;
      if (!logits) throw new Error("Tiny timer model returned no decoder logits");

      const beamCandidates = [];
      const fallbackCandidates = [];
      for (const next of selectTopTokenLogProbs(logits.data, logits.dims, TINY_TIMER_TOPK_PER_BEAM)) {
        const done = next.token === 1;
        const outputIds = done ? beam.outputIds : [...beam.outputIds, next.token];
        const candidate = {
          ids: done ? beam.ids : [...beam.ids, BigInt(next.token)],
          outputIds,
          score: beam.score + next.logProb,
          done,
          constraintFallback: beam.constraintFallback,
        };
        const decoded = decodeTimerDslCandidate(tokenizer, outputIds);
        if (!candidateValidator || candidateValidator(decoded, done, outputIds)) {
          beamCandidates.push(candidate);
        } else if (!isTimerDslHardInvalidPrefix(decoded)) {
          fallbackCandidates.push({ ...candidate, constraintFallback: true });
        }
      }
      if (beamCandidates.length) {
        candidates.push(...beamCandidates);
      } else {
        const fallback = fallbackCandidates.find((candidate) => !candidate.done) ?? fallbackCandidates[0];
        if (fallback) candidates.push(fallback);
      }
    }

    const nextBeams = candidates
      .sort((left, right) => rankBeam(right) - rankBeam(left))
      .slice(0, TINY_TIMER_NUM_BEAMS);

    if (!nextBeams.length) break;
    beams = nextBeams;

    if (beams.every((beam) => beam.done)) break;
  }

  return beams.sort((left, right) => rankBeam(right) - rankBeam(left))[0]?.outputIds || [];
}

function decodeTimerDslCandidate(tokenizer, outputIds) {
  return String(tokenizer.decode(outputIds, { skip_special_tokens: true })).trim();
}

function isAllowedTimerDslCandidate(decoded, done, outputIds) {
  if (done) return Boolean(decoded) && isCompleteTimerDsl(decoded);
  if (!decoded && outputIds.length) return false;
  return isTimerDslPrefix(decoded);
}

function tensorData(tensor) {
  return tensor?.data || tensor;
}

function toBigInt64Array(data) {
  if (data instanceof BigInt64Array) return data;
  return BigInt64Array.from(Array.from(data, (value) => BigInt(value)));
}

export function selectGreedyToken(logitsData, logitsDims) {
  return selectTopTokenLogProbs(logitsData, logitsDims, 1)[0]?.token ?? 0;
}

function selectTopTokenLogProbs(logitsData, logitsDims, topK) {
  const vocabSize = logitsDims.at(-1);
  const sequenceLength = logitsDims.at(-2);
  const offset = (sequenceLength - 1) * vocabSize;

  let maxLogit = -Infinity;
  for (let token = 0; token < vocabSize; token += 1) {
    const value = logitsData[offset + token];
    if (value > maxLogit) maxLogit = value;
  }

  let expSum = 0;
  const top = [];
  for (let token = 0; token < vocabSize; token += 1) {
    const value = logitsData[offset + token];
    expSum += Math.exp(value - maxLogit);
    if (top.length < topK || value > top.at(-1).logit) {
      top.push({ token, logit: value });
      top.sort((left, right) => right.logit - left.logit);
      if (top.length > topK) top.pop();
    }
  }
  const logDenominator = maxLogit + Math.log(expSum);
  return top.map((entry) => ({
    token: entry.token,
    logProb: entry.logit - logDenominator,
  }));
}

function rankBeam(beam) {
  const length = Math.max(1, beam.outputIds.length);
  return beam.score / length;
}

function normalizeProgress(progress) {
  const value = Number(progress?.progress);
  if (!Number.isFinite(value)) return 0;
  return value > 1 ? Math.min(1, value / 100) : Math.max(0, Math.min(1, value));
}

function formatProgressStatus(progress) {
  if (typeof progress?.file === "string" && progress.file) {
    return `Loading ${progress.file}`;
  }
  if (typeof progress?.status === "string" && progress.status) {
    return progress.status;
  }
  return "Loading tiny timer model";
}
