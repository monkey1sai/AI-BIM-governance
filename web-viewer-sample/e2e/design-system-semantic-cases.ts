import type { Page } from "@playwright/test";

export type SemanticCaseContext = {
  page: Page;
  screenId: string;
  productionRoute: string;
};

export type SemanticExpectation =
  | "visible"
  | "hidden"
  | "enabled"
  | "disabled"
  | "text_equals"
  | "text_contains"
  | "attribute_equals"
  | "count_equals";

export type SemanticAssertionDefinition = {
  id: string;
  locator: string;
  expectation: SemanticExpectation;
  expected?: string | number;
  attribute?: string;
};

export type SemanticCaseDefinition = {
  prepare: (context: SemanticCaseContext) => Promise<void>;
  assertions: readonly SemanticAssertionDefinition[];
};

// Bootstrap contract: semantic state variants are intentionally not marked complete.
// Product UI changes remain fail-closed until each "<screen-id>:<case-id>" key has a
// reviewed setup plus concrete DOM assertions. The Playwright spec, not this registry,
// performs every observation/expectation and writes the machine result.
export const semanticCaseDefinitions: ReadonlyMap<string, SemanticCaseDefinition> =
  new Map();
