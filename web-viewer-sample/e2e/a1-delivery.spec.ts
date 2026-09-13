import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { loadIsolatedStackConfig, requireReal, watchForbiddenRequests } from "./support/isolated-stack";

test("A1 real library run → Issues → version-scoped downloads → snapshot → revised run", async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const stack = loadIsolatedStackConfig();
  requireReal(stack, "A1 delivery requires the official isolated stack");
  const fixturePath = process.env.A1_DELIVERY_E2E_FIXTURE;
  requireReal(fixturePath, "owner-prepared library fixture required");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
  expect(fixture.original_sha256).toBe("8fe7efdbbf56d42b8a6b73c4a580e1f3d6a364afec7aa903a852a7ef2759ddce");
  expect(digest(fixture.original_file)).toBe(fixture.original_sha256);
  expect(digest(fixture.revised_file)).toBe(fixture.revised_sha256);
  expect(digest(path.join(stack.readOnlyFixtureRoot, fixture.local_original_key))).toBe(fixture.original_sha256);
  expect(digest(path.join(stack.readOnlyFixtureRoot, fixture.local_revised_key))).toBe(fixture.revised_sha256);
  // 只建 metadata session；不分配 Kit、不造假 READY artifact/first-frame。
  const sessionResponse = await request.post(`${stack.coordinatorBaseUrl}/api/review-sessions`, { data: {
    project_id: "library-validation", model_version_id: fixture.local_original_key,
    options: { auto_allocate_kit: false }, artifact_bindings: [], created_by: "local-delivery-validation",
  } });
  expect(sessionResponse.status()).toBe(200);
  const sessionId = (await sessionResponse.json()).session_id;
  const guard = watchForbiddenRequests(page, stack.coordinatorBaseUrl);
  const posts: string[] = [];
  page.on("request", event => { if (event.method() === "POST") posts.push(new URL(event.url()).pathname); });
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
  try {
    await page.goto("/#a1");
    await page.getByTestId("a1-source-local").click();
    await page.getByTestId("a1-localfs-select").selectOption(fixture.local_original_key);
    await page.getByTestId("a1-step-pick").click();
    await page.getByTestId("a1-ids-path").fill("");
    const runResponse = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/api/governance-library/rule-runs"));
    await page.getByTestId("a1-step-run").click();
    const originalRunId = (await (await runResponse).json()).rule_run_id;
    await expect(page.getByTestId("a1-issue-counts")).toHaveText("68 筆問題・68 個構件・68 個無法定位", { timeout: 120_000 });
    const run = await (await request.get(`${stack.coordinatorBaseUrl}/api/governance/rule-runs/${originalRunId}`)).json();
    expect(run.model_version_id).toBe(fixture.local_original_key);
    expect(run.summary.source_sha256).toBe(fixture.original_sha256);
    expect(run.summary.failed).toBe(68);
    for (const expectedCreated of [68, 0]) {
      const created = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/issues/from-rule-run/${originalRunId}`));
      await page.getByTestId("a1-step-issues").click();
      expect((await (await created).json()).created).toBe(expectedCreated);
      await expect(page.getByTestId("a1-step-bcf")).toBeEnabled();
    }
    const issues = (await (await request.get(`${stack.coordinatorBaseUrl}/api/governance/issues`, {
      params: { model_version_id: fixture.local_original_key, kind: "issue" },
    })).json()).issues;
    expect(issues).toHaveLength(68);
    // 預先建立的 for-ifc-ready 原版問題屬另一 version，確保不是空資料庫的假隔離。
    const foreign = (await (await request.get(`${stack.coordinatorBaseUrl}/api/governance/issues`, {
      params: { model_version_id: fixture.original_model_version_id, kind: "issue" },
    })).json()).issues;
    expect(foreign.length).toBeGreaterThan(0);
    const excelDownload = page.waitForEvent("download");
    await page.getByTestId("a1-step-export").click();
    const excelPath = info.outputPath("library.xlsx"); await (await excelDownload).saveAs(excelPath);
    const bcfDownload = page.waitForEvent("download");
    const exportResponse = page.waitForResponse(r => new URL(r.url()).pathname.endsWith("/bcf/export"));
    await page.getByTestId("a1-step-bcf").click();
    expect(new URL((await exportResponse).url()).searchParams.get("model_version_id")).toBe(fixture.local_original_key);
    const bcfPath = info.outputPath("library.bcfzip"); await (await bcfDownload).saveAs(bcfPath);
    const python = process.env.A1_E2E_PYTHON || path.join(stack.manifest.worktree_root, ".venv", "Scripts", "python.exe");
    // 檢查實際下載 bytes，不用下載檔名或 HTTP 200 推論 BCF 正確。
    const archive = JSON.parse(execFileSync(python, ["-c", `import json,sys,zipfile,xml.etree.ElementTree as E
with zipfile.ZipFile(sys.argv[2]) as x:
 assert 'xl/workbook.xml' in x.namelist()
with zipfile.ZipFile(sys.argv[1]) as z:
 assert E.fromstring(z.read('bcf.version')).attrib['VersionId']=='2.1'
 topics=[]
 for name in z.namelist():
  if name.endswith('/markup.bcf'):
   root=E.fromstring(z.read(name)); topic=root.find('Topic'); folder=name.split('/')[0]
   assert topic.attrib['Guid']==folder
   vp=E.fromstring(z.read(folder+'/'+root.findtext('Viewpoints/Viewpoint')))
   assert vp.attrib['Guid']==root.find('Viewpoints').attrib['Guid']
   topics.append({'topic':folder,'guid':vp.find('.//Component').attrib['IfcGuid'],'comment':root.findtext('Comment/Comment'),'title':topic.findtext('Title')})
 print(json.dumps(topics))`, bcfPath, excelPath], { encoding: "utf8" }));
    expect(archive).toHaveLength(issues.length);
    expect(archive.map((topic: { guid: string }) => topic.guid).sort()).toEqual(issues.map((issue: { ifc_guid: string }) => issue.ifc_guid).sort());
    for (const topic of archive) {
      expect(topic.comment).toContain(`[model_version=${fixture.local_original_key} ·`);
      expect(issues.some((issue: { ifc_guid: string; title: string }) => issue.ifc_guid === topic.guid && issue.title === topic.title)).toBe(true);
    }
    await expect(page.getByTestId("a1-bcf-exported-artifact")).toBeVisible();
    await page.getByTestId("a1-session-select").selectOption(sessionId);
    await expect(page.getByTestId("a1-issue-snapshot")).toBeEnabled();
    const snapshotResponse = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`/review-sessions/${sessionId}/issue-snapshot`));
    await page.getByTestId("a1-issue-snapshot").click();
    const snapshot = await snapshotResponse; expect(snapshot.status()).toBe(202);
    const outboxId = (await snapshot.json()).outbox_id;
    await expect(page.getByTestId("a1-issue-snapshot-result")).toContainText(outboxId);
    await expect(page.getByTestId("a1-outbox-status")).toContainText("尚未確認送達");
    await page.getByRole("button", { name: "重新查詢遞送狀態", exact: true }).click();
    await expect(page.getByTestId("a1-outbox-status")).toContainText("尚未確認送達");
    await page.screenshot({ path: info.outputPath("original-deliverables.png"), fullPage: true });
    for (const dock of ["a2", "a3", "a4", "a1"]) {
      await page.locator(`[data-uc="dock-tab-${dock}"]`).click();
      await expect(page.getByTestId("measurement-start")).toBeDisabled();
    }
    await expect(page.getByTestId("a1-issue-snapshot-result")).toContainText(outboxId);
    await page.getByTestId("a1-localfs-select").selectOption(fixture.local_revised_key);
    await page.getByTestId("a1-step-pick").click();
    await expect(page.getByTestId("a1-issue-snapshot-result")).toHaveCount(0);
    const revisedResponse = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith("/api/governance-library/rule-runs"));
    await page.getByTestId("a1-step-run").click();
    const revisedRunId = (await (await revisedResponse).json()).rule_run_id;
    // running 的空結果也顯示 0，必須先等待檢核終態的交付按鈕才讀 summary。
    await expect(page.getByTestId("a1-step-export")).toBeEnabled({ timeout: 120_000 });
    await expect(page.getByTestId("a1-issue-counts")).toHaveText("0 筆問題・0 個構件・0 個無法定位", { timeout: 120_000 });
    await expect(page.getByTestId("a1-step-bcf")).toBeDisabled();
    await expect(page.getByTestId("a1-issue-snapshot")).toBeDisabled();
    const revised = await (await request.get(`${stack.coordinatorBaseUrl}/api/governance/rule-runs/${revisedRunId}`)).json();
    expect(revised.summary.source_sha256).toBe(fixture.revised_sha256);
    expect(revised.summary.failed).toBe(0);
    await page.screenshot({ path: info.outputPath("revised-source-clears-delivery.png"), fullPage: true });
    guard.assertClean();
    expect(posts.some(url => /viewer-lease|runtime-command-authorizations|conversion\/retry/.test(url))).toBe(false);
    expect(digest(fixture.original_file)).toBe(fixture.original_sha256);
    await info.attach("a1-delivery-evidence", { contentType: "application/json", body: Buffer.from(JSON.stringify({
      head: stack.manifest.head_sha, originalRunId, revisedRunId, sessionId, outboxId,
      originalSHA: fixture.original_sha256, revisedSHA: fixture.revised_sha256,
      bcfTopics: archive.length, original: run.summary, revised: revised.summary,
      sessionKind: "metadata-only-without-artifact-or-Kit", cloudDelivered: false, gpuVerified: false,
    })) });
  } finally { await page.context().tracing.stop({ path: info.outputPath("trace.zip") }); }
});
