#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { compareTimerOutputs, parseTimerActions, parseTimerDsl, parseTimerJson, readAssistantTarget } from "./timer-sft-lib.mjs";

const args = parseArgs(process.argv.slice(2));
const records = (await readJsonl(resolve(process.cwd(), args.dataset))).slice(0, args.limit ?? undefined);
const targetFormat = args.targetFormat === "auto" ? records[0]?.targetFormat ?? "json" : args.targetFormat;
const results = [];
let parsePasses = 0;
let strictPasses = 0;
let semanticPasses = 0;

for (const [index, record] of records.entries()) {
  const expectedTimers = readAssistantTarget(record);
  const messages = record.messages.filter((message) => message.role !== "assistant");

  let result;
  let content = null;
  try {
    content = await complete(messages);
    const parsed = parseModelOutput(content, `${record.id}: model output`, record.targetFormat ?? targetFormat, record);
    parsePasses += 1;
    const strictErrors = compareTimerOutputs(expectedTimers, parsed.timers, { ignoreLabels: false });
    const semanticErrors = compareTimerOutputs(expectedTimers, parsed.timers, { ignoreLabels: true });
    if (!strictErrors.length) strictPasses += 1;
    if (!semanticErrors.length) semanticPasses += 1;

    result = {
      id: record.id,
      category: record.category,
      parseOk: true,
      ok: !strictErrors.length,
      semanticOk: !semanticErrors.length,
      strictErrors,
      semanticErrors,
      expected: expectedTimers,
      actual: parsed.timers,
      rawContent: content,
    };
  } catch (error) {
    result = {
      id: record.id,
      category: record.category,
      parseOk: false,
      ok: false,
      semanticOk: false,
      strictErrors: [String(error?.message || error)],
      semanticErrors: [String(error?.message || error)],
      expected: expectedTimers,
      actual: null,
      rawContent: content,
    };
  }

  results.push(result);
  if (!args.quiet && (!result.ok || args.verbose)) {
    const status = result.ok ? "PASS" : result.semanticOk ? "SEMANTIC" : "FAIL";
    console.log(`${status} ${index + 1}/${records.length} ${record.id} ${record.category}`);
    for (const error of result.strictErrors.slice(0, 4)) console.log(`  ${error}`);
  }
}

const strictRate = formatPercent(strictPasses, records.length);
const semanticRate = formatPercent(semanticPasses, records.length);
const parseRate = formatPercent(parsePasses, records.length);
console.log(`Parseable ${targetFormat.toUpperCase()}: ${parsePasses}/${records.length} (${parseRate})`);
console.log(`Strict exact: ${strictPasses}/${records.length} (${strictRate})`);
console.log(`Semantic exact ignoring labels: ${semanticPasses}/${records.length} (${semanticRate})`);

const categorySummary = summarizeResultsByCategory(results);
printCategorySummary(categorySummary);

if (args.out) {
  const outPath = resolve(process.cwd(), args.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${results.map((result) => JSON.stringify(result)).join("\n")}\n`, "utf8");
}

if (args.summaryOut) {
  const summaryPath = resolve(process.cwd(), args.summaryOut);
  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(
    summaryPath,
    `${JSON.stringify(
      {
        model: args.model,
        dataset: args.dataset,
        targetFormat,
        total: records.length,
        parseable: parsePasses,
        strictExact: strictPasses,
        semanticExact: semanticPasses,
        categories: Object.fromEntries(categorySummary.map((entry) => [entry.category, entry])),
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

if (strictPasses !== records.length) {
  process.exitCode = 1;
}

async function complete(messages) {
  const url = `${args.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const body = {
    model: args.model,
    messages,
    temperature: 0,
    max_tokens: args.maxTokens,
  };
  if (args.adapters) {
    body.adapters = args.adapters;
  }
  if (args.responseFormat && targetFormat === "json") {
    body.response_format = { type: "json_object" };
  }

  const headers = {
    "content-type": "application/json",
  };
  if (args.apiKey) headers.authorization = `Bearer ${args.apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Completion response was not JSON: ${error.message}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error(`Completion response did not include choices[0].message.content`);
  }
  return content.trim();
}

async function readJsonl(path) {
  const text = await readFile(path, "utf8");
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${path}:${index + 1}: invalid JSONL row: ${error.message}`);
      }
    });
}

function parseArgs(argv) {
  const parsed = {
    apiKey: process.env.TIMEY_EVAL_API_KEY || process.env.OPENAI_API_KEY || "",
    adapters: process.env.TIMEY_EVAL_ADAPTERS || "",
    baseUrl: process.env.TIMEY_EVAL_BASE_URL || "http://127.0.0.1:11434/v1",
    dataset: "training/generated/timer-sft-validation.jsonl",
    limit: null,
    maxTokens: 2048,
    model: process.env.TIMEY_EVAL_MODEL || "",
    out: "",
    quiet: false,
    responseFormat: true,
    summaryOut: "",
    targetFormat: "auto",
    verbose: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--api-key") parsed.apiKey = argv[++index];
    else if (arg === "--adapters") parsed.adapters = argv[++index];
    else if (arg === "--base-url") parsed.baseUrl = argv[++index];
    else if (arg === "--dataset") parsed.dataset = argv[++index];
    else if (arg === "--limit") parsed.limit = Number(argv[++index]);
    else if (arg === "--max-tokens") parsed.maxTokens = Number(argv[++index]);
    else if (arg === "--model") parsed.model = argv[++index];
    else if (arg === "--out") parsed.out = argv[++index];
    else if (arg === "--summary-out") parsed.summaryOut = argv[++index];
    else if (arg === "--quiet") parsed.quiet = true;
    else if (arg === "--no-response-format") parsed.responseFormat = false;
    else if (arg === "--target-format") parsed.targetFormat = argv[++index];
    else if (arg === "--verbose") parsed.verbose = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  if (!parsed.model) {
    console.error("Missing --model or TIMEY_EVAL_MODEL.");
    printHelp();
    process.exit(1);
  }
  if (parsed.limit !== null && (!Number.isInteger(parsed.limit) || parsed.limit < 1)) {
    throw new Error("--limit must be a positive integer");
  }
  if (!Number.isInteger(parsed.maxTokens) || parsed.maxTokens < 1) {
    throw new Error("--max-tokens must be a positive integer");
  }
  if (!["auto", "json", "dsl", "actions"].includes(parsed.targetFormat)) {
    throw new Error("--target-format must be auto, json, dsl, or actions");
  }

  return parsed;
}

function parseModelOutput(content, context, format, record) {
  if (format === "dsl") return parseTimerDsl(content, context);
  if (format === "actions") return parseTimerActions(content, record.metadata?.actionSlots, context);
  return parseTimerJson(content, context);
}

function printHelp() {
  console.log(`Usage: node scripts/training/eval-timer-model.mjs --model <model> [options]

Evaluates a generated Timey SFT validation set against an OpenAI-compatible
chat completions endpoint such as Ollama, LM Studio, llama.cpp server, vLLM,
or a hosted endpoint.

Options:
  --model <name>              Model name to send to the endpoint
  --adapters <path>           Adapter path for servers that support LoRA adapters, such as mlx_lm.server
  --base-url <url>            Base URL (default: http://127.0.0.1:11434/v1)
  --api-key <key>             Bearer token (default: TIMEY_EVAL_API_KEY or OPENAI_API_KEY)
  --dataset <path>            JSONL dataset (default: training/generated/timer-sft-validation.jsonl)
  --limit <n>                 Evaluate only the first n rows
  --max-tokens <n>            Completion token budget (default: 2048)
  --out <path>                Write prediction JSONL
  --summary-out <path>        Write aggregate and per-category summary JSON
  --no-response-format        Do not send response_format=json_object
  --target-format <auto|json|dsl|actions>
                              Parse target format (default: auto from dataset)
  --quiet                     Print only the final summary
  --verbose                   Print passing rows too`);
}

function formatPercent(count, total) {
  if (!total) return "0.0%";
  return `${((count / total) * 100).toFixed(1)}%`;
}

function summarizeResultsByCategory(results) {
  const buckets = new Map();
  for (const result of results) {
    const category = result.category || "uncategorized";
    const bucket =
      buckets.get(category) ??
      {
        category,
        count: 0,
        parseable: 0,
        strictExact: 0,
        semanticExact: 0,
      };
    bucket.count += 1;
    if (result.parseOk) bucket.parseable += 1;
    if (result.ok) bucket.strictExact += 1;
    if (result.semanticOk) bucket.semanticExact += 1;
    buckets.set(category, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => ({
      ...bucket,
      parseableRate: rate(bucket.parseable, bucket.count),
      strictExactRate: rate(bucket.strictExact, bucket.count),
      semanticExactRate: rate(bucket.semanticExact, bucket.count),
    }))
    .sort((left, right) => left.strictExactRate - right.strictExactRate || left.category.localeCompare(right.category));
}

function printCategorySummary(summary) {
  if (!summary.length) return;

  console.log("By category:");
  for (const entry of summary) {
    console.log(
      [
        `  ${entry.category}:`,
        `strict ${entry.strictExact}/${entry.count} (${formatPercent(entry.strictExact, entry.count)})`,
        `semantic ${entry.semanticExact}/${entry.count} (${formatPercent(entry.semanticExact, entry.count)})`,
        `parse ${entry.parseable}/${entry.count} (${formatPercent(entry.parseable, entry.count)})`,
      ].join(" "),
    );
  }
}

function rate(count, total) {
  if (!total) return 0;
  return Number((count / total).toFixed(4));
}
