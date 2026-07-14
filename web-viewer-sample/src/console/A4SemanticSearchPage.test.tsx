import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { A4SemanticSearchPage } from "./A4SemanticSearchPage";

describe("A4SemanticSearchPage", () => {
  it("renders live workbench shell (not vision placeholder)", () => {
    const html = renderToString(<A4SemanticSearchPage />);
    expect(html).toContain("a4-semantic-search-page");
    expect(html).toContain("a4-query-input");
    expect(html).toContain("a4-run");
    expect(html).toContain("FireRating");
    expect(html).not.toContain("後端未建");
  });
});
