// CFD Settings Catalog — drift guard（決策見 docs/architecture/cfd-settings-catalog-adr.md）。
// 產出檔的 source-sha256 必須等於現行 request schema（LF 正規化後）的雜湊；不需網路、不需 Python。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const lf = (text: string) => text.replace(/\r\n/g, "\n");
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const regenerate = "run: cd web-viewer-sample && npm run generate:cfd-settings-catalog";

describe("CFD Settings Catalog drift", () => {
  it("src/generated/cfd-settings-catalog.ts was generated from the committed request schema", () => {
    const schema = lf(readFileSync(path.join(repoRoot, "tests", "contracts", "cfd-run-request-v1.schema.json"), "utf8"));
    const generated = lf(readFileSync(
      path.join(repoRoot, "bim-review-coordinator", "src", "generated", "cfd-settings-catalog.ts"),
      "utf8",
    ));
    const match = /^\/\/ source-sha256: ([0-9a-f]{64})$/m.exec(generated.split("\n").slice(0, 8).join("\n"));
    expect(match, regenerate).not.toBeNull();
    expect(match?.[1], regenerate).toBe(sha256(schema));
  });
});
