#!/usr/bin/env node
import { parseTimerActions } from "./timer-sft-lib.mjs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

const items = JSON.parse(chunks.join(""));
const results = items.map((item, index) => {
  try {
    return {
      ok: true,
      timers: parseTimerActions(item.content, item.slots, `action prediction ${index + 1}`).timers,
    };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message || error),
      timers: [],
    };
  }
});

process.stdout.write(`${JSON.stringify(results)}\n`);
