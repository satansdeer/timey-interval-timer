import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const releaseVersion = "v0.1.0";
const hfNamespace = process.env.HF_NAMESPACE || "Satansdeer";
const modelRepoName = "timmy-t2";
const datasetRepoName = "timmy-t2-timer-sft";
const modelRepoId = `${hfNamespace}/${modelRepoName}`;
const datasetRepoId = `${hfNamespace}/${datasetRepoName}`;
const stagingRoot = join(repoRoot, "release", "huggingface", `timmy-t2-${releaseVersion}`);
const modelStage = join(stagingRoot, "model");
const datasetStage = join(stagingRoot, "dataset");

const checkpointDir = join(
  repoRoot,
  "training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50",
);
const browserModelDir = join(repoRoot, "models/timey-t5-efficient-tiny");
const datasetDir = join(
  repoRoot,
  "training/generated-actions-lossless-item-atoms-seqlen-orderhints-phase4y",
);

const evalSummaries = [
  [
    "eval/onnx-dynq8enc-q4dec-validation-summary.json",
    "training/seq2seq-runs/phase4y-action-onnx-dynq8enc-q4dec-validation-eval/summary.json",
  ],
  [
    "eval/onnx-dynq8enc-q4dec-hard-summary.json",
    "training/seq2seq-runs/phase4y-action-onnx-dynq8enc-q4dec-hard-eval/summary.json",
  ],
  [
    "eval/onnx-dynq8enc-q4dec-hidden-summary.json",
    "training/seq2seq-runs/phase4y-action-onnx-dynq8enc-q4dec-hidden-eval/summary.json",
  ],
  [
    "eval/onnx-dynq8enc-q4dec-browser-failures-summary.json",
    "training/seq2seq-runs/phase4y-action-onnx-dynq8enc-q4dec-browser-failures-eval/summary.json",
  ],
  [
    "eval/fp32-validation-summary.json",
    "training/seq2seq-runs/phase4y-actions-browser-exact-dataset-step50-validation-eval/summary.json",
  ],
  [
    "eval/fp32-hard-summary.json",
    "training/seq2seq-runs/phase4y-actions-browser-exact-dataset-step50-hard-eval/summary.json",
  ],
  [
    "eval/fp32-hidden-summary.json",
    "training/seq2seq-runs/phase4y-actions-browser-exact-dataset-step50-hidden-eval/summary.json",
  ],
];

const modelFiles = [
  "config.json",
  "generation_config.json",
  "model.safetensors",
  "special_tokens_map.json",
  "spiece.model",
  "tokenizer.json",
  "tokenizer_config.json",
];

const browserFiles = [
  "config.json",
  "generation_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_quantized.onnx",
  "onnx/decoder_model_quantized.onnx",
];

const datasetFiles = [
  ["data/train.jsonl", "timer-sft-train.jsonl"],
  ["data/validation.jsonl", "timer-sft-validation.jsonl"],
  ["data/hard_validation.jsonl", "timer-sft-hard-validation.jsonl"],
  ["data/all_public.jsonl", "timer-sft-all.jsonl"],
  ["timer-sft-manifest.json", "timer-sft-manifest.json"],
];

await rm(stagingRoot, { recursive: true, force: true });
await mkdir(modelStage, { recursive: true });
await mkdir(datasetStage, { recursive: true });

for (const file of modelFiles) {
  await copyFile(join(checkpointDir, file), join(modelStage, file));
}

for (const file of browserFiles) {
  await copyFile(join(browserModelDir, file), join(modelStage, "browser", file));
}

for (const [target, source] of datasetFiles) {
  await copyFile(join(datasetDir, source), join(datasetStage, target));
}

for (const [target, source] of evalSummaries) {
  await copyFile(join(repoRoot, source), join(modelStage, target));
}

const gitCommit = runGit(["rev-parse", "--short", "HEAD"]);
const llmPlanner = await readText("llm-planner.js");
const modelVersion = matchConst(llmPlanner, "TRAINED_TINY_MODEL_VERSION");
const modelDtype = matchConst(llmPlanner, "TRAINED_TINY_MODEL_DTYPE");
const transformersVersion = matchConst(llmPlanner, "TRANSFORMERS_PACKAGE_VERSION");
const onnxRuntimeVersion = matchConst(llmPlanner, "ONNXRUNTIME_WEB_VERSION");
const datasetManifest = await readJson(join(datasetDir, "timer-sft-manifest.json"));
const trainingSummary = await readJson(
  join(repoRoot, "training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/summary.json"),
);
const evalMetrics = await buildEvalMetrics();
const stagedModelFiles = await collectFiles(modelStage);
const stagedDatasetFiles = await collectFiles(datasetStage);

const releaseManifest = {
  release: {
    name: "Timmy T2",
    expansion: "Timmy Timer Translator",
    version: releaseVersion,
    modelRepo: modelRepoId,
    datasetRepo: datasetRepoId,
    sourceGitCommit: gitCommit,
    productionDeployId: "6a0ed36e0172c100ef1ab8ac",
    productionUrl: "https://timey-interval-timer.netlify.app",
  },
  model: {
    id: "timey-t5-efficient-tiny",
    version: modelVersion,
    dtype: modelDtype,
    architecture: "T5ForConditionalGeneration",
    ancestry:
      "Task-specific continuation from internal T5 Efficient Tiny checkpoints; final release checkpoint is phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50.",
    trainingRun: trainingSummary.training,
    generation: {
      maxNewTokens: 64,
      numBeams: 4,
      topKPerBeam: 8,
      transformersJs: transformersVersion,
      onnxRuntimeWeb: onnxRuntimeVersion,
    },
  },
  dataset: {
    source: "training/generated-actions-lossless-item-atoms-seqlen-orderhints-phase4y",
    publicSplits: {
      train: datasetManifest.train.count,
      validation: datasetManifest.validation.count,
      hardValidation: datasetManifest.hardValidation.count,
      allPublic: datasetManifest.all.count,
    },
    hiddenSplitWithheld: {
      count: datasetManifest.hiddenValidation.count,
      reason: "Kept out of the public dataset repo so future iterations retain a private holdout.",
    },
  },
  evaluations: evalMetrics,
  browserSmoke: {
    date: "2026-05-21",
    serviceWorkersEnabled: true,
    prompts: [
      {
        input: "5 one minute timers and one 30 second",
        rawContent: "REP C0 A0 ADD A1 END",
        expectedDurationsSeconds: [60, 60, 60, 60, 60, 30],
      },
      {
        input: "first and last timer 5 minute, 5 one minute timers in between",
        rawContent: "ADD A0 REP C0 A1 ADD A0 END",
        expectedDurationsSeconds: [300, 60, 60, 60, 60, 60, 300],
      },
    ],
    uiSmoke:
      "Assistant UI loaded Tiny model - timey-t5-efficient-tiny, source tiny-llm, and produced [60,60,60,60,60,30].",
  },
  files: {
    model: await fileInfoFor(stagedModelFiles, modelStage),
    dataset: await fileInfoFor(stagedDatasetFiles, datasetStage),
  },
};

await writeJson(join(modelStage, "release_manifest.json"), releaseManifest);
await writeJson(join(datasetStage, "release_manifest.json"), {
  release: releaseManifest.release,
  dataset: releaseManifest.dataset,
  sourceModel: modelRepoId,
  schema: "See SCHEMA.md.",
  files: releaseManifest.files.dataset,
});
await writeText(join(modelStage, "README.md"), modelCard({ releaseManifest, datasetManifest }));
await writeText(join(modelStage, "browser", "README.md"), browserReadme({ releaseManifest }));
await writeText(join(datasetStage, "README.md"), datasetCard({ releaseManifest, datasetManifest }));
await writeText(join(datasetStage, "SCHEMA.md"), datasetSchema());

console.log(JSON.stringify({ stagingRoot, modelStage, datasetStage, modelRepoId, datasetRepoId }, null, 2));

async function buildEvalMetrics() {
  const metrics = {};
  for (const [target, source] of evalSummaries) {
    const summary = await readJson(join(repoRoot, source));
    const step = summary.steps.at(-1);
    const name = target.replace(/^eval\//, "").replace(/-summary\.json$/, "");
    metrics[name] = {
      records: step?.semanticExactRate ? Math.round(step.semanticExact / step.semanticExactRate) : step?.parseable,
      parseableRate: step?.parseableRate,
      strictExactRate: step?.strictExactRate,
      semanticExactRate: step?.semanticExactRate,
      semanticInvalidRate: step?.semanticInvalidRate,
    };
  }
  return metrics;
}

async function copyFile(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}

async function collectFiles(root) {
  const entries = await import("node:fs/promises").then(({ readdir }) =>
    readdir(root, { recursive: true, withFileTypes: true }),
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

async function fileInfoFor(files, root) {
  const info = {};
  for (const file of files) {
    const rel = relative(root, file);
    const fileStat = await stat(file);
    info[rel] = {
      bytes: fileStat.size,
      sha256: await sha256(file),
    };
  }
  return info;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readText(file) {
  return readFile(join(repoRoot, file), "utf8");
}

async function writeJson(file, value) {
  await writeText(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, value);
}

function runGit(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function matchConst(source, name) {
  const pattern = new RegExp(`export const ${name} = "([^"]+)"`);
  const match = source.match(pattern);
  if (!match) throw new Error(`Could not find ${name}`);
  return match[1];
}

function percent(value) {
  return `${Math.round(Number(value) * 1000) / 10}%`;
}

function metricRows(metrics) {
  return Object.entries(metrics)
    .map(
      ([name, metric]) =>
        `| ${name} | ${metric.records} | ${percent(metric.parseableRate)} | ${percent(metric.strictExactRate)} | ${percent(metric.semanticExactRate)} | ${percent(metric.semanticInvalidRate)} |`,
    )
    .join("\n");
}

function modelCard({ releaseManifest, datasetManifest }) {
  return `---
library_name: transformers
pipeline_tag: translation
tags:
- t5
- seq2seq
- onnx
- transformers.js
- browser-ml
- timers
- synthetic-data
datasets:
- ${releaseManifest.release.datasetRepo}
license: apache-2.0
---

# Timmy T2

Timmy T2 stands for **Timmy Timer Translator**. It is a tiny, browser-first seq2seq model for translating natural-language timer requests into Timey's compact action DSL.

This is not a new foundation architecture. It is a task-specific fine-tuned T5-style encoder-decoder model plus a compact output language, lossless slot-annotated input format, constrained parser, and browser ONNX runtime package.

## Release

- Version: \`${releaseManifest.release.version}\`
- Runtime model version: \`${releaseManifest.model.version}\`
- Production commit: \`${releaseManifest.release.sourceGitCommit}\`
- Production deploy: \`${releaseManifest.release.productionDeployId}\`
- Dataset: [${releaseManifest.release.datasetRepo}](https://huggingface.co/datasets/${releaseManifest.release.datasetRepo})

## Intended Use

Timmy T2 is intended for Timey-style timer planning:

\`\`\`text
5 one minute timers and one 30 second
\`\`\`

The model emits action commands over extracted slot ids:

\`\`\`text
REP C0 A0
ADD A1
END
\`\`\`

The application parses those commands into concrete timers deterministically.

## Files

- Root files are the fp32/safetensors checkpoint for Python Transformers.
- \`browser/\` contains the production browser artifact:
  - dynamic q8 encoder ONNX
  - q4 decoder ONNX
  - tokenizer/config files used by the Timey browser runtime
- \`eval/\` contains release evaluation summaries.
- \`release_manifest.json\` records hashes, sizes, evals, and production smoke checks.

## Training Data

Public dataset rows:

| Split | Rows |
| --- | ---: |
| train | ${datasetManifest.train.count} |
| validation | ${datasetManifest.validation.count} |
| hard_validation | ${datasetManifest.hardValidation.count} |
| all_public | ${datasetManifest.all.count} |

The ${datasetManifest.hiddenValidation.count}-row hidden validation split is withheld from the public dataset to preserve a private holdout.

## Evaluation

| Eval | Records | Parseable | Strict exact | Semantic exact | Semantic invalid |
| --- | ---: | ---: | ---: | ---: | ---: |
${metricRows(releaseManifest.evaluations)}

## Browser Smoke

The deployed production browser runtime was smoke-tested with service workers enabled. It loaded \`timey-t5-efficient-tiny\` and produced the expected timer sequences for:

- \`5 one minute timers and one 30 second\` -> \`[60, 60, 60, 60, 60, 30]\`
- \`first and last timer 5 minute, 5 one minute timers in between\` -> \`[300, 60, 60, 60, 60, 60, 300]\`

## Limitations

- This is a narrow task model for timer requests, not a general assistant.
- It expects Timey's lossless slot-annotated input format at inference time.
- Correction/edit requests are intentionally handled by deterministic fallback logic in the app.
- Public validation is synthetic and task-targeted; broader natural user traffic should be evaluated before expanding claims.
`;
}

function browserReadme({ releaseManifest }) {
  return `# Browser Runtime Artifact

This folder contains the production browser artifact for Timmy T2 ${releaseManifest.release.version}.

The Timey app uses Transformers.js ${releaseManifest.model.generation.transformersJs} for tokenization and ONNX Runtime Web ${releaseManifest.model.generation.onnxRuntimeWeb} for explicit encoder/decoder inference.

Files:

- \`onnx/encoder_model_quantized.onnx\`: dynamic q8 encoder
- \`onnx/decoder_model_quantized.onnx\`: q4 decoder
- tokenizer and config files copied from the production browser model directory

The browser artifact is validated through the app's parser and production smoke checks. See \`../release_manifest.json\` for hashes, sizes, and eval summaries.
`;
}

function datasetCard({ releaseManifest, datasetManifest }) {
  return `---
tags:
- timers
- synthetic-data
- seq2seq
- text2text-generation
- dsl
license: apache-2.0
---

# Timmy T2 Timer SFT Dataset

This dataset trains **Timmy T2**, the Timmy Timer Translator model, to convert natural-language timer requests into Timey's compact action DSL.

Model repo: [${releaseManifest.release.modelRepo}](https://huggingface.co/${releaseManifest.release.modelRepo})

## Splits

| Split | File | Rows |
| --- | --- | ---: |
| train | \`data/train.jsonl\` | ${datasetManifest.train.count} |
| validation | \`data/validation.jsonl\` | ${datasetManifest.validation.count} |
| hard_validation | \`data/hard_validation.jsonl\` | ${datasetManifest.hardValidation.count} |
| all_public | \`data/all_public.jsonl\` | ${datasetManifest.all.count} |

The hidden validation split (${datasetManifest.hiddenValidation.count} rows) is intentionally not included in this public release.

## Format

Each row is a chat-style supervised fine-tuning example with:

- \`messages[0]\`: system instruction
- \`messages[1]\`: user request plus lossless extracted slots
- \`messages[2]\`: assistant target action plan
- \`metadata.expectedTimers\`: deterministic timer expansion used for semantic evaluation
- \`metadata.actionSlots\`: extracted durations, counts, labels, atoms, items, and order hints

See \`SCHEMA.md\` for the action language and field details.

## Categories

The final dataset combines core regression rows, generic timer count/position rows, label-copy rows, user-request contrast rows, order-hint rows, sequence-length pedagogy, and browser-action exact rows.

Top-level public category counts are recorded in \`timer-sft-manifest.json\`.

## Caveats

The dataset is synthetic and intentionally narrow. It is suitable for timer translation research and Timey-compatible model training, not for general instruction tuning.
`;
}

function datasetSchema() {
  return `# Timmy T2 Dataset Schema

Rows are JSONL records.

## Main Fields

- \`id\`: stable synthetic row id.
- \`datasetVersion\`: dataset generation date.
- \`category\`: generator/evaluation category.
- \`targetFormat\`: \`actions\` for this release.
- \`userFormat\`: \`lossless-item-atoms\` for this release.
- \`messages\`: chat-style SFT messages.
- \`metadata.userRequest\`: original natural-language timer request.
- \`metadata.expectedTimers\`: fully expanded expected timers.
- \`metadata.actionSlots\`: lossless extracted slots available to the model.

## Action DSL

The assistant target is a compact command sequence ending in \`END\`.

Commands:

- \`ADD A0\`: append one atom/item.
- \`REP C0 A0\`: repeat one atom/item count times.
- \`SEQn A0 A1 ...\`: append an explicit sequence of exactly n ids.
- \`ALT C0 A0 A1\`: alternate two atom/item ids count times.
- \`BLOCK C0 A0 A1\`: repeat a two-item block count times.
- \`END\`: terminate the plan.

Slot ids refer to the user message:

- \`C*\`: count slots.
- \`D*\`: duration slots.
- \`L*\`: label slots.
- \`A*\`: atom slots, combining duration plus label.
- \`I*\`: item slots, preserving explicit source item positions.
- \`O*\`: order hints for role/order ambiguity.

Models should use ids exactly as provided and should not emit raw durations, counts, or labels.
`;
}
