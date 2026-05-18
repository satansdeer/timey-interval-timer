#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  DATASET_VERSION,
  DEFAULT_TARGET_FORMAT,
  DEFAULT_USER_FORMAT,
  QWEN3_DSL_NO_THINK_SYSTEM_PROMPT,
  QWEN3_NO_THINK_SYSTEM_PROMPT,
  buildTimerSftExamples,
  splitTimerSftExamples,
  summarizeRecords,
} from "./timer-sft-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(process.cwd(), args.outDir);
const allRecords = buildTimerSftExamples({
  dslEndToken: args.dslEndToken,
  targetFormat: args.targetFormat,
  userFormat: args.userFormat,
  systemPrompt: getSystemPrompt(args),
});
const { train, validation } = splitTimerSftExamples(allRecords, {
  validationRatio: args.validationRatio,
});

await mkdir(outDir, { recursive: true });
await writeJsonl(resolve(outDir, "timer-sft-all.jsonl"), [...train, ...validation]);
await writeJsonl(resolve(outDir, "timer-sft-train.jsonl"), train);
await writeJsonl(resolve(outDir, "timer-sft-validation.jsonl"), validation);
await writeFile(
  resolve(outDir, "timer-sft-manifest.json"),
  `${JSON.stringify(
    {
      datasetVersion: DATASET_VERSION,
      targetFormat: args.targetFormat,
      userFormat: args.userFormat,
      dslEndToken: args.targetFormat === "dsl" ? args.dslEndToken : false,
      qwen3NoThink: args.qwen3NoThink,
      validationRatio: args.validationRatio,
      files: {
        all: "timer-sft-all.jsonl",
        train: "timer-sft-train.jsonl",
        validation: "timer-sft-validation.jsonl",
      },
      all: summarizeRecords([...train, ...validation]),
      train: summarizeRecords(train),
      validation: summarizeRecords(validation),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Wrote ${train.length} train and ${validation.length} validation examples to ${outDir}`);

function writeJsonl(path, records) {
  return writeFile(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

function parseArgs(argv) {
  const parsed = {
    outDir: "training/generated",
    dslEndToken: false,
    qwen3NoThink: false,
    targetFormat: DEFAULT_TARGET_FORMAT,
    userFormat: DEFAULT_USER_FORMAT,
    validationRatio: 0.18,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out-dir") {
      parsed.outDir = argv[++index];
    } else if (arg === "--dsl-end-token") {
      parsed.dslEndToken = true;
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
  return args.targetFormat === "dsl" ? QWEN3_DSL_NO_THINK_SYSTEM_PROMPT : QWEN3_NO_THINK_SYSTEM_PROMPT;
}

function printHelp() {
  console.log(`Usage: node scripts/training/build-timer-sft.mjs [options]

Options:
  --out-dir <path>             Output directory (default: training/generated)
  --dsl-end-token              End DSL assistant targets with END on a final line
  --qwen3-no-think             Append /no_think to the system prompt for Qwen3 non-thinking mode
  --target-format <json|dsl>   Assistant target format (default: json)
  --user-format <app|natural>  App payload or raw natural-language user turns (default: app)
  --validation-ratio <number>  Fraction of flexible rows held out by category (default: 0.18)`);
}
