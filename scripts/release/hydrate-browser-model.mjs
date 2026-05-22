import { execFileSync } from "node:child_process";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const modelRepo = process.env.TIMMY_T2_MODEL_REPO || "Satansdeer/timmy-t2";
const modelId = "timey-t5-efficient-tiny";
const tmpRoot = join(tmpdir(), `timmy-t2-browser-model-${Date.now()}`);
const sourceRoot = join(tmpRoot, "browser");
const targetRoot = join(repoRoot, "models", modelId);

await rm(tmpRoot, { recursive: true, force: true });
await mkdir(tmpRoot, { recursive: true });
await mkdir(join(targetRoot, "onnx"), { recursive: true });

execFileSync(
  "hf",
  [
    "download",
    modelRepo,
    "--include",
    "browser/*",
    "--local-dir",
    tmpRoot,
    "--force-download",
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

for (const file of ["config.json", "generation_config.json", "tokenizer.json", "tokenizer_config.json"]) {
  await cp(join(sourceRoot, file), join(targetRoot, file));
}

for (const file of ["encoder_model_quantized.onnx", "decoder_model_quantized.onnx"]) {
  await cp(join(sourceRoot, "onnx", file), join(targetRoot, "onnx", file));
}

await rm(tmpRoot, { recursive: true, force: true });

console.log(`Hydrated ${modelId} from ${modelRepo} into ${targetRoot}`);
