import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

export type SkippedTestRecord = {
  title: string;
  status: string;
};

export function skippedTestsViolateRealGate(
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
  skipped: readonly SkippedTestRecord[],
): string | null {
  if (env.E2E_REQUIRE_REAL !== "1") return null;
  if (skipped.length === 0) return null;
  const titles = skipped.map((item) => item.title).join(", ");
  return (
    `E2E_REQUIRE_REAL=1 forbids skipped tests (${skipped.length}): ${titles}. ` +
    "conditional skip is not a pass; see docs/agents/product-operability-and-script-contract.md."
  );
}

export default class ForbidSkippedWhenRealReporter implements Reporter {
  private readonly skipped: SkippedTestRecord[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status === "skipped") {
      this.skipped.push({
        title: test.titlePath().join(" > "),
        status: result.status,
      });
    }
  }

  onEnd(): void {
    const message = skippedTestsViolateRealGate(process.env, this.skipped);
    if (!message) return;
    console.error(message);
    process.exitCode = 1;
  }
}
