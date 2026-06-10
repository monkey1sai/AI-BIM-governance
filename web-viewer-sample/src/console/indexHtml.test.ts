import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("coordinator /ui shell html", () => {
  it("does not reference the Vite root favicon that 404s under coordinator /ui", () => {
    const html = readFileSync(path.join(process.cwd(), "index.html"), "utf8");

    expect(html).not.toContain("/vite.svg");
  });
});
