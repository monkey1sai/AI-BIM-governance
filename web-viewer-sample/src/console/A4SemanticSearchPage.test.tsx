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
    expect(html).toContain("transport_class");
    expect(html).not.toContain("base_url");
    expect(html).not.toContain('k="auth"');
    expect(html).toContain("a4-source-session");
    expect(html).toContain("a4-source-ifc_ready");
    expect(html).not.toContain("a4-path-input");
    expect(html).not.toContain("a4-source-path");
    expect(html).not.toContain("a4-create-issues");
    expect(html).toContain("a4-table-only");
    expect(html).toContain("a4-retry");
    expect(html).toContain("a4-confirm-partial");
    expect(html).toContain("a4-session-unavailable");
  });
});
