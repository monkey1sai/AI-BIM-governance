import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { loadIsolatedStackConfig, requireReal, watchForbiddenRequests } from "./support/isolated-stack";

test("A1 library remediation confirmation, durable history and authorized reopen", async ({ page, request }, testInfo) => {
  const isolated = loadIsolatedStackConfig();
  requireReal(isolated, "A1 remediation acceptance requires the official isolated stack manifest");
  const fixturePath = process.env.A1_REMEDIATION_E2E_FIXTURE;
  requireReal(fixturePath, "owner-prepared real IFC run/Issue fixture is required");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  requireReal(fixture.original_sha256 === "8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce", "wrong original IFC");
  const issueId = fixture.e2e_issue_id, guid = fixture.e2e_guid;
  requireReal(typeof issueId === "string" && typeof guid === "string", "observed Issue identity missing");
  const guard = watchForbiddenRequests(page, isolated.coordinatorBaseUrl);
  const mutations: string[] = [];
  page.on("request", event => { if (event.method() === "POST") mutations.push(new URL(event.url()).pathname); });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await page.goto("/#a1");
    await page.getByRole("button", { name: "載入既有規則問題", exact: true }).click();
    const row = page.getByTestId("a1-bcf-review-panel").getByRole("row").filter({ hasText: guid });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "核對整改", exact: true }).click();
    const form = page.getByRole("region", { name: "整改確認", exact: true });
    await expect(form.getByText(/本地驗證模式/)).toBeVisible();
    await form.getByRole("combobox", { name: "修正版檢核", exact: true }).selectOption(fixture.revised_run_id);
    const result = form.getByRole("combobox", { name: "依據結果", exact: true });
    await expect(result.locator("option")).toHaveCount(2);
    await result.selectOption({ index: 1 });
    await form.getByRole("checkbox", { name: "我已核對原版與修正版的構件及檢核結果" }).check();
    await form.getByRole("textbox", { name: "整改說明", exact: true }).fill("驗證用途：保留原 IFC GUID，補入 FireRating 測試值；核對完整 PASS 與整改歷史，不作實際防火性能認證。");
    const confirmed = page.waitForResponse(response => response.url().endsWith(`/issues/${issueId}/confirm-remediation`) && response.request().method() === "POST");
    await form.getByRole("button", { name: "確認整改", exact: true }).click();
    expect((await confirmed).status()).toBe(200);
    const history = page.getByRole("region", { name: "整改紀錄", exact: true });
    await expect(history.locator('[data-current-status="resolved"]')).toBeVisible();
    await expect(row).toContainText("resolved");
    await page.screenshot({ path: testInfo.outputPath("confirmed.png"), fullPage: true });
    const before = await request.get(`${isolated.coordinatorBaseUrl}/api/governance/issues/${issueId}/remediation-history`);
    expect(before.status()).toBe(200); const snapshot = await before.json();
    expect(snapshot.items).toHaveLength(1);
    await page.reload();
    await page.getByRole("button", { name: "載入既有規則問題", exact: true }).click();
    await row.getByRole("button", { name: "查看整改紀錄", exact: true }).click();
    await expect(history.locator('[data-current-status="resolved"]')).toBeVisible();
    await history.getByRole("textbox", { name: "重開說明", exact: true }).fill("驗證用途：重新檢視问题，保留已確認的原版／修正版證據。");
    await history.getByRole("checkbox", { name: "我已核對並要重新開啟這筆問題" }).check();
    await history.getByRole("button", { name: "重新開啟問題", exact: true }).click();
    await expect(history.locator('[data-current-status="reopened"]')).toBeVisible();
    await expect(row).toContainText("reopened");
    const after = await request.get(`${isolated.coordinatorBaseUrl}/api/governance/issues/${issueId}/remediation-history`);
    const reopened = await after.json(); expect(reopened.items).toEqual(snapshot.items);
    expect(reopened.issue.revision).toBe(snapshot.issue.revision + 1);
    await row.getByRole("button", { name: "核對整改", exact: true }).click();
    await expect(form.getByRole("combobox", { name: "修正版檢核", exact: true })).toBeVisible();
    await expect(form.getByRole("combobox", { name: "修正版檢核", exact: true }).locator(`option[value="${fixture.revised_run_id}"]`)).toHaveCount(0);
    await expect(form.getByRole("button", { name: "確認整改", exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath("reopened.png"), fullPage: true });
    const denied = await request.post(`${isolated.coordinatorBaseUrl}/api/governance/issues/${issueId}/confirm-remediation`, {
      headers: { Origin: "http://attacker.invalid", "X-A1-Intent": "confirm" },
      data: { expected_revision: reopened.issue.revision, revised_model_version_id: fixture.revised_model_version_id,
        revised_run_id: fixture.revised_run_id, revised_result_id: snapshot.items[0].revised.anchor_id, idempotency_key: "cross-origin-test" },
    });
    expect(denied.status()).toBe(403);
    expect(mutations).not.toContainEqual(expect.stringMatching(/viewer-lease|review-sessions.*\/open|conversion\/retry/));
    guard.assertClean();
    await testInfo.attach("a1-real-evidence", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      head_sha: isolated.manifest.head_sha, issueId, guid, originalRunId: fixture.original_run_id,
      revisedRunId: fixture.revised_run_id, originalSHA: fixture.original_sha256, revisedSHA: fixture.revised_sha256,
      confirmationId: snapshot.items[0].id, actorKind: snapshot.items[0].actor_kind,
      status: reopened.issue.status, revision: reopened.issue.revision, fixture_kind: "local-derived-library-ifc",
      kitRuntimeVerified: false, sourceReadonly: true,
    })) });
  } finally { await page.context().tracing.stop({ path: testInfo.outputPath("trace.zip") }); }
});
