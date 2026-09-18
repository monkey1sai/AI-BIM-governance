// Kit Command Vocabulary — drift guard（決策見 docs/architecture/kit-command-vocabulary-adr.md）。
// 產出檔的 source-sha256 必須等於現行 schema（LF 正規化後）的雜湊；不需網路、不需 Python。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const regenerate = "run: cd web-viewer-sample && npm run generate:kit-command-vocabulary";

describe("Kit Command Vocabulary drift", () => {
  it("src/generated/kit-command-vocabulary.ts was generated from the committed schema", () => {
    const schema = lf(readFileSync(path.join(repoRoot, "tests", "contracts", "kit-datachannel-v1.schema.json"), "utf8"));
    const generated = lf(readFileSync(
      path.join(repoRoot, "bim-review-coordinator", "src", "generated", "kit-command-vocabulary.ts"),
      "utf8",
    ));
    const match = /^\/\/ source-sha256: ([0-9a-f]{64})$/m.exec(generated.split("\n").slice(0, 8).join("\n"));
    expect(match, regenerate).not.toBeNull();
    expect(match?.[1], regenerate).toBe(sha256(schema));
  });
});
