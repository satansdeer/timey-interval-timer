import { readFileSync } from "node:fs";
import { getTimerDslPrefixState, parseTimerDsl } from "../../timer-dsl.js";

const input = JSON.parse(readFileSync(0, "utf8") || "[]");
const contents = Array.isArray(input) ? input : input.contents;

if (!Array.isArray(contents)) {
  throw new Error("Expected a JSON array of DSL strings");
}

const results = contents.map((content, index) => {
  const source = String(content || "");
  const prefixState = getTimerDslPrefixState(source);
  const semanticInvalid = prefixState.reason === "semantic-invalid";
  try {
    return {
      ok: true,
      semanticInvalid,
      semanticInvalidDetail: semanticInvalid ? prefixState.detail : null,
      timers: parseTimerDsl(source, `prediction ${index + 1}`).timers,
    };
  } catch (error) {
    return {
      ok: false,
      semanticInvalid,
      semanticInvalidDetail: semanticInvalid ? prefixState.detail : null,
      error: error.message,
    };
  }
});

process.stdout.write(`${JSON.stringify(results)}\n`);
