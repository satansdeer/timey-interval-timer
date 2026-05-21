#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DATASET_VERSION,
  DEFAULT_TARGET_FORMAT,
  DEFAULT_USER_FORMAT,
  QWEN3_ACTION_NO_THINK_SYSTEM_PROMPT,
  QWEN3_DSL_NO_THINK_SYSTEM_PROMPT,
  QWEN3_NO_THINK_SYSTEM_PROMPT,
  buildTimerSftExamples,
  splitTimerSftExamples,
  summarizeRecords,
} from "./timer-sft-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(process.cwd(), args.outDir);
const allRecords = buildTimerSftExamples({
  actionOrderHints: args.actionOrderHints,
  actionSeqLength: args.actionSeqLength,
  dslEndToken: args.dslEndToken,
  includePhase4HardData: args.phase4HardData,
  includeUserRequestExpansion: args.userRequestExpansion,
  includePhase4HResidualData: args.phase4HResidualData,
  includePhase4IBrowserResidualData: args.phase4IBrowserResidualData,
  includePhase4OResidualData: args.phase4OResidualData,
  includePhase4PSeqLengthData: args.phase4PSeqLengthData,
  includePhase4QRoleOrderData: args.phase4QRoleOrderData,
  includePhase4YBrowserActionExactData: args.phase4YBrowserActionExactData,
  targetFormat: args.targetFormat,
  userFormat: args.userFormat,
  systemPrompt: getSystemPrompt(args),
});
const { train, validation, hardValidation, hiddenValidation } = splitTimerSftExamples(allRecords, {
  validationRatio: args.validationRatio,
});

await mkdir(outDir, { recursive: true });
await writeJsonl(resolve(outDir, "timer-sft-all.jsonl"), [...train, ...validation]);
await writeJsonl(resolve(outDir, "timer-sft-train.jsonl"), train);
await writeJsonl(resolve(outDir, "timer-sft-validation.jsonl"), validation);
if (hardValidation.length > 0) {
  await writeJsonl(resolve(outDir, "timer-sft-hard-validation.jsonl"), hardValidation);
}
if (hiddenValidation.length > 0) {
  await writeJsonl(resolve(outDir, "timer-sft-hidden-validation.jsonl"), hiddenValidation);
}
await writeFile(
  resolve(outDir, "timer-sft-manifest.json"),
  `${JSON.stringify(
    {
      datasetVersion: DATASET_VERSION,
      targetFormat: args.targetFormat,
      userFormat: args.userFormat,
      actionOrderHints: args.targetFormat === "actions" ? args.actionOrderHints : false,
      actionSeqLength: args.targetFormat === "actions" ? args.actionSeqLength : false,
      dslEndToken: args.targetFormat === "dsl" ? args.dslEndToken : false,
      phase4HardData: args.phase4HardData,
      userRequestExpansion: args.userRequestExpansion,
      phase4HResidualData: args.phase4HResidualData,
      phase4IBrowserResidualData: args.phase4IBrowserResidualData,
      phase4OResidualData: args.phase4OResidualData,
      phase4PSeqLengthData: args.phase4PSeqLengthData,
      phase4QRoleOrderData: args.phase4QRoleOrderData,
      phase4YBrowserActionExactData: args.phase4YBrowserActionExactData,
      qwen3NoThink: args.qwen3NoThink,
      validationRatio: args.validationRatio,
      files: {
        all: "timer-sft-all.jsonl",
        train: "timer-sft-train.jsonl",
        validation: "timer-sft-validation.jsonl",
        ...(hardValidation.length > 0 ? { hardValidation: "timer-sft-hard-validation.jsonl" } : {}),
        ...(hiddenValidation.length > 0 ? { hiddenValidation: "timer-sft-hidden-validation.jsonl" } : {}),
      },
      all: summarizeRecords([...train, ...validation]),
      train: summarizeRecords(train),
      validation: summarizeRecords(validation),
      ...(hardValidation.length > 0 ? { hardValidation: summarizeRecords(hardValidation) } : {}),
      ...(hiddenValidation.length > 0 ? { hiddenValidation: summarizeRecords(hiddenValidation) } : {}),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(
  `Wrote ${train.length} train, ${validation.length} validation` +
    `${hardValidation.length > 0 ? `, and ${hardValidation.length} hard validation` : ""}` +
    `${hiddenValidation.length > 0 ? `, plus ${hiddenValidation.length} hidden validation` : ""}` +
    ` examples to ${outDir}`,
);

function writeJsonl(path, records) {
  return writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function parseArgs(argv) {
  const parsed = {
    outDir: "training/generated",
    actionOrderHints: false,
    actionSeqLength: false,
    dslEndToken: false,
    phase4HardData: false,
    userRequestExpansion: false,
    phase4HResidualData: false,
    phase4IBrowserResidualData: false,
    phase4OResidualData: false,
    phase4PSeqLengthData: false,
    phase4QRoleOrderData: false,
    phase4YBrowserActionExactData: false,
    qwen3NoThink: false,
    targetFormat: DEFAULT_TARGET_FORMAT,
    userFormat: DEFAULT_USER_FORMAT,
    validationRatio: 0.18,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir") {
      parsed.outDir = argv[++index];
    } else if (arg === "--action-order-hints") {
      parsed.actionOrderHints = true;
    } else if (arg === "--action-seq-length") {
      parsed.actionSeqLength = true;
    } else if (arg === "--dsl-end-token") {
      parsed.dslEndToken = true;
    } else if (arg === "--phase4-hard-data") {
      parsed.phase4HardData = true;
    } else if (arg === "--user-request-expansion") {
      parsed.userRequestExpansion = true;
    } else if (arg === "--phase4h-residual-data") {
      parsed.phase4HResidualData = true;
    } else if (arg === "--phase4i-browser-residual-data") {
      parsed.phase4IBrowserResidualData = true;
    } else if (arg === "--phase4o-residual-data") {
      parsed.phase4OResidualData = true;
    } else if (arg === "--phase4p-seq-length-data") {
      parsed.phase4PSeqLengthData = true;
    } else if (arg === "--phase4q-role-order-data") {
      parsed.phase4QRoleOrderData = true;
    } else if (arg === "--phase4y-browser-action-exact-data") {
      parsed.phase4YBrowserActionExactData = true;
    } else if (arg === "--qwen3-no-think") {
      parsed.qwen3NoThink = true;
    } else if (arg === "--target-format") {
      parsed.targetFormat = argv[++index];
    } else if (arg === "--user-format") {
      parsed.userFormat = argv[++index];
    } else if (arg === "--validation-ratio") {
      parsed.validationRatio = Number(argv[++index]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  if (!Number.isFinite(parsed.validationRatio) || parsed.validationRatio <= 0 || parsed.validationRatio >= 1) {
    throw new Error("--validation-ratio must be greater than 0 and less than 1");
  }

  return parsed;
}

function getSystemPrompt(args) {
  if (!args.qwen3NoThink) return undefined;
  if (args.targetFormat === "actions") return QWEN3_ACTION_NO_THINK_SYSTEM_PROMPT;
  return args.targetFormat === "dsl" ? QWEN3_DSL_NO_THINK_SYSTEM_PROMPT : QWEN3_NO_THINK_SYSTEM_PROMPT;
}

function printHelp() {
  console.log(`Usage: node scripts/training/build-timer-sft.mjs [options]

Options:
  --out-dir <path>             Output directory (default: training/generated)
  --action-order-hints         Add lossless role order hints to action prompts
  --action-seq-length          Use SEQn action opcodes, for example SEQ3 I0 I1 I2
  --dsl-end-token              End DSL assistant targets with END on a final line
  --phase4-hard-data           Include opt-in hard generic-position/generic-timer rows
  --user-request-expansion     Include opt-in broad user-request and contrast rows
  --phase4h-residual-data      Include train-only residual rows from current best misses
  --phase4i-browser-residual-data
                                Include train-only rows from raw browser misses
  --phase4o-residual-data      Include train-only targeted residual rows after Phase 4N
  --phase4p-seq-length-data    Include train-only pedagogy rows for SEQn action syntax
  --phase4q-role-order-data    Include role/order/count curriculum rows plus hidden stress eval
  --phase4y-browser-action-exact-data
                                Include high-frequency exact rows for raw browser action misses
  --qwen3-no-think             Append /no_think to the system prompt for Qwen3 non-thinking mode
  --target-format <json|dsl|actions>
                                Assistant target format (default: json)
  --user-format <app|natural|lossless-slots|lossless-atoms|lossless-items|lossless-item-atoms>
                                App payload, raw natural turns, raw request plus span-backed slots, atom slots, source-ordered item slots, or hybrid item/atom slots (default: app)
  --validation-ratio <number>  Fraction of flexible rows held out by category (default: 0.18)`);
}
