#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { summarizeRecords, validateDatasetRecord } from "./timer-sft-lib.mjs";

const args = parseArgs(process.argv.slice(2));
let total = 0;

for (const path of args.paths) {
  const records = await readJsonl(resolve(process.cwd(), path));
  const userRequests = new Map();

  for (const record of records) {
    validateDatasetRecord(record);
    const request = record.metadata?.userRequest;
    if (request) {
      const normalized = request.toLowerCase().replace(/\s+/g, " ").trim();
      const duplicateAllowed = Boolean(record.metadata?.duplicateOk);
      if (userRequests.has(normalized) && !duplicateAllowed) {
        throw new Error(`${path}: duplicate user request "${request}"`);
      }
      userRequests.set(normalized, userRequests.get(normalized) || duplicateAllowed);
    }
  }

  total += records.length;
  const summary = summarizeRecords(records);
  console.log(`${path}: ${summary.count} records`);
  for (const [category, count] of Object.entries(summary.categories).sort()) {
    console.log(`  ${category}: ${count}`);
  }
}

console.log(`Validated ${total} records.`);

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
    paths: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      parsed.paths.push(arg);
    }
  }

  if (!parsed.paths.length) {
    parsed.paths = ["training/generated/timer-sft-train.jsonl", "training/generated/timer-sft-validation.jsonl"];
  }

  return parsed;
}

function printHelp() {
  console.log(`Usage: node scripts/training/validate-timer-sft.mjs [jsonl ...]

Validates Timey timer SFT JSONL files. Defaults to the generated train and validation files.`);
}
