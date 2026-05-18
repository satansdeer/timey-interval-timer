import { readFileSync } from "node:fs";
import { parseTimerDsl } from "../../timer-dsl.js";

const input = JSON.parse(readFileSync(0, "utf8") || "[]");
const contents = Array.isArray(input) ? input : input.contents;

if (!Array.isArray(contents)) {
  throw new Error("Expected a JSON array of DSL strings");
}

const results = contents.map((content, index) => {
  try {
    return {
      ok: true,
      timers: parseTimerDsl(String(content || ""), `prediction ${index + 1}`).timers,
    };
  } catch (error) {
    return {
      ok: false,
      error: error.message,
    };
  }
});

process.stdout.write(`${JSON.stringify(results)}\n`);
