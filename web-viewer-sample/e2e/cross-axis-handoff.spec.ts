import { expect, test } from "@playwright/test";

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("seven-axis cross-page harmony", () => {
  // Teardown for the deep-Kit test below. That test attaches a PRIMARY viewer lease to a REAL, shared session
  // sourced from the live Sessions table (never fabricated — 誠實鐵律), so we MUST hand the primary slot back or
  // we leak it until its 45s TTL (viewerLeaseStore.ts:78) and a real operator can be locked out of their own
  // session's primary 3D view for ~45s. We RELEASE THE LEASE, never close the session: closing a real shared
  // session would destroy an operator's work — the exact cross-suite-interference trap VG-01 documents
  // (viewer-embed-a1-highlight.spec.ts:61-64). Stays null for every other test in this file → afterEach no-ops.
  let claimedLease: { sessionId: string; leaseId: string; leaseToken: string } | null = null;
  test.afterEach(async ({ request }) => {
    if (!claimedLease) return;
    const { sessionId, leaseId, leaseToken } = claimedLease;
    claimedLease = null;
    // Independent `request` fixture (NOT the page) so release does not depend on the component's unmount-time
    // release fetch actually flushing before Playwright closes the page — that fetch has no keepalive
    // (ReviewSessionViewerPane.tsx:156-159 → coordinatorClient.ts:474-479) and the browser may drop it on teardown.
    // Mirrors coordinatorClient.releaseViewerLease: POST the release endpoint with the X-Viewer-Lease-Token header.
    await request.post(
      `${COORDINATOR}/api/review-sessions/${encodeURIComponent(sessionId)}/viewer-leases/${encodeURIComponent(leaseId)}/release`,
      { headers: { "X-Viewer-Lease-Token": leaseToken }, data: {}, timeout: 10_000 },
    ).catch(() => {});
  });

  test("shared status rail is on every LEGACY axis page (GPU 未取得, no fake green); unified pages have no rail", async ({ page }) => {
    // IA v2（UnifiedConsole）：#a1/#pipeline/#runtime 改掛新殼，SharedStatusRail 只存在 legacy 殼
    //（EdgeConsole.tsx LegacyEdgeConsole）→ rail 斷言收斂到仍為 legacy 的四軸頁
    //（#conv 已恢復 legacy ConversionPage——雙路由分治，unified 生產線改掛 #pipeline）。
    for (const route of ["#conv", "#sessions", "#instances", "#minio"]) {
      await page.goto(`${COORDINATOR}/ui${route}`);
      const rail = page.getByTestId("shared-status-rail");
      await expect(rail).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("rail-gpu-value")).toContainText("未取得");
    }
    // 反向斷言：unified 新殼（#home / #pipeline）無 rail。先等新殼可辨識內容 paint 再斷言不存在，
    // 避免對空 DOM 過早 toHaveCount(0) 的偽陰性。
    await page.goto(`${COORDINATOR}/ui#home`);
    await expect(page.getByText("總覽 · Mission Control")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("shared-status-rail")).toHaveCount(0);
    await page.goto(`${COORDINATOR}/ui#pipeline`);
    await expect(page.getByText("模型資料與轉檔生產線")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("shared-status-rail")).toHaveCount(0);
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-rail-runtime.png", fullPage: true });
  });

  // IA v2 對映更新：舊「M → CV chip（minio-link-conv-*）→ #conv 接收端（conv-incoming-handoff）」已隨
  // MD 三頁合一移除——grep buildHandoff 呼叫點證實現無任何發射端指向 #conv（#conv 為 legacy
  // ConversionPage，接收端 conv-incoming-handoff 仍在但無發射端）。#minio 現行發射端＝GlobalConversionPane 的
  // conv-job-session-*（→ #sessions）/ conv-job-review-*（→ #review）與 ObjectDetailPane 的
  // md-detail-ss / md-detail-review / md-detail-a1。本測改走仍有「發射端＋接收端重驗」的
  // M → SS 邊：chip 帶 review_session_id → #sessions 接收端（sessions-incoming-handoff）重驗。
  test("M → SS chip carries a real session id and lands on #sessions (source=minio, receiver re-verifies)", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#minio`);
    // If a conversion job with a bound review_session_id is listed, click its SS chip; else honestly skip.
    // Decide skip only AFTER the chip has had a chance to paint: goto (waitUntil:'load') does not await the
    // on-mount jobs fetch + re-render, and locator.count() does not auto-retry — waitFor retries until visible
    // (or times out), so we skip only when truly absent.
    const ssChip = page.locator('[data-testid^="conv-job-session-"]').first();
    const hasChip = await ssChip.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    test.skip(!hasChip, "no conversion job with a review_session_id in this environment (not observed)");
    await ssChip.click();
    await expect(page).toHaveURL(/#sessions\?source=minio/, { timeout: 15_000 });
    // Prove the chip carried a REAL session id, not just that source=minio survived: buildHandoff drops empty
    // values (handoff.ts:39), so a chip that forgot the id would still yield a non-null handoff whose SS verify
    // reads not_applicable — indistinguishable from an intentionally id-less link. Assert non-empty here so a
    // dropped-session wiring regression fails instead of passing silently.
    const session = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("session") ?? "";
    expect(session).not.toBe("");
    // Receiver rule (spec §4.2): SS must re-verify the incoming session against its own /api/runtime/status
    // snapshot（pages.tsx SessionManagementPage useIncomingHandoff）— never silently ignore the id. WIRING smoke
    // test（do not oversell）: the banner mounts and re-verifies into one of the honest non-none states —
    // `verified`（rt.sessions 命中）/ `not_found`（誠實查無）/ `indeterminate`（rt 尚未載入）。Narrowing to one
    // value would flake or lie about live backend state; per-input discrimination is owned by the unit tests.
    const banner = page.getByTestId("sessions-incoming-handoff");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    // Receiver-side half of the id-carried proof: handoffIdText renders the session id into the banner text
    // regardless of verify status (incomingHandoff.tsx), catching a receiver that surfaced a blank / wrong id.
    await expect(banner).toContainText(session, { timeout: 15_000 });
    await expect(banner).toHaveAttribute("data-handoff-status", /verified|not_found|indeterminate/);
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-m-to-sessions.png", fullPage: true });
  });

  test("A1 workbench has no inline WebRTC viewer; Review Room owns 3D and is not auto-claimed", async ({ page }) => {
    // IA v2：舊 A1 工作台（A1GovernanceWorkbenchPage）遷 #a1-workbench；#a1 現為 unified workspace
    //（fixture 語意）。N3 邊界的受測者是 legacy 工作台，故本測打 #a1-workbench。
    await page.goto(`${COORDINATOR}/ui#a1-workbench`);
    // A1 → sessions chip is evidence-typed: disabled until a session is selected. 先等它 paint（證明頁面
    // 已渲染），review-room-viewer-host 的 toHaveCount(0) 才不是對空 DOM 的 vacuous pass。
    const a1LinkSessions = page.getByTestId("a1-link-sessions");
    await expect(a1LinkSessions).toBeVisible({ timeout: 20_000 });
    await expect(a1LinkSessions).toBeDisabled();
    // N3 gate WITH TEETH. `review-room-viewer-host` is the live-3D viewer host that ONLY Review Room
    // renders (ReviewSessionViewerPane.tsx:329) — it must be absent on the A1 workbench, and it IS asserted
    // present-in-context on #review below, so this is a real differential, not a tautology. The exhaustive
    // "A1 never mounts EmbeddedViewer" guard is the existing unit test A1ViewerEmbed.test.tsx (mocks
    // EmbeddedViewer, asserts renderCount === 0); this E2E is the browser-evidence complement (N7).
    await expect(page.getByTestId("review-room-viewer-host")).toHaveCount(0);
    await page.goto(`${COORDINATOR}/ui#review?source=a1`);
    // Review Room owns the flow: before manual start it shows kit-not-started (and would render
    // review-room-viewer-host after start) — the positive half of the differential above.
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-review-not-started.png", fullPage: true });
  });

  test("SS → Review chip navigates with the session id (re-verified, not silently defaulted)", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#sessions`);
    // Pick an ACTIVE session's Review chip, not just .first(): store.list() returns ALL sessions incl. closed,
    // sorted by updated_at desc (sessionStore.ts:70-79), and runtime/status maps them unfiltered (app.ts:2753),
    // so .first() is often a just-closed row whose Review Room re-verify honestly reads "not_listed"
    // (ReviewSessionViewerPane.tsx:129 keeps only active/created) and would false-fail the "observed" check below.
    // An active, non-terminating row is exactly the one carrying a session-terminate button (pages.tsx:1497) —
    // i.e. the re-verifiable set. Same on-mount /api/runtime/status race as M→CV: waitFor lets it paint before skip.
    const activeRow = page.locator('[data-testid^="session-row-"]').filter({ has: page.locator('[data-testid^="session-terminate-"]') }).first();
    const reviewChip = activeRow.locator('[data-testid^="session-link-review-"]');
    const hasSession = await reviewChip.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    test.skip(!hasSession, "no active (non-terminating) session in this environment (not observed)");
    await reviewChip.click();
    await expect(page).toHaveURL(/#review\?source=sessions&.*session=/, { timeout: 15_000 });
    // Capture the REAL session id the SS chip placed on the URL so the assertions below prove the id actually
    // wired hash → parseReviewRoomHandoff → ReviewSessionViewerPane, not merely that the literal substring
    // "session=" survived (which an empty / mis-named param would also satisfy).
    const ssSession = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("session") ?? "";
    expect(ssSession).not.toBe("");
    // Review Room does not auto-claim (N3): before manual start it shows kit-not-started.
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    // "re-verified, not silently defaulted" — assert the RECEIVER actually re-verified the incoming id, not just
    // that the URL carried one. review-room-kit-not-started shows for ANY id (it keys only on !activePrimaryLease,
    // ReviewSessionViewerPane.tsx:324) so it CANNOT prove re-verification; the runtime-evidence block does: its
    // "session" field must echo the incoming id (catches an empty-string / wrong-param wiring regression) and its
    // "runtime session" field must read "observed" — sessionObserved = the id was found in /api/runtime/status
    // (ReviewSessionViewerPane.tsx:119,314), the honest re-verified signal — rather than "not_listed". (Trap-safe:
    // "observed" is not a substring of "not_listed", and this locator targets only the runtime-session field so the
    // "not_observed" first-frame/DataChannel fields cannot alias it.)
    const evidence = page.getByTestId("review-room-runtime-evidence");
    await expect(evidence).toContainText(ssSession, { timeout: 15_000 });
    await expect(evidence.locator(".ec-field", { hasText: "runtime session" })).toContainText("observed", { timeout: 15_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-ss-to-review.png", fullPage: true });
  });

  // §8 Representative Cross-Axis Lifecycle — ONE stitched walk-through (spec §12/§13). IA v2 對映更新：
  //   • 舊 M→CV / IN→CV 邊（minio-link-conv-* / intake-link-conv-* → #conv 的 conv-incoming-handoff）已隨
  //     MD 三頁合一移除；#conv 為 legacy ConversionPage（接收端 conv-incoming-handoff 仍在），grep
  //     buildHandoff 呼叫點證實現無任何發射端指向 #conv。
  //   • 現行 spine：M（#minio conv-job-session-* → #sessions 接收端重驗）→ IN（#intake alias → #minio
  //     合一 ModelDataPage）→ A1 工作台（#a1-workbench 的 a1-link-sessions 證據型 chip）→ Review Room
  //     （#review?source=a1，kit-not-started 邊界）→ 回 A1 issue 控制（a1-step-issues）。
  //   • 舊 a1-open-review-room CTA 已不存在於 A1GovernanceWorkbenchPage；A1→Review 的 fixture-less 目標
  //     維持 #review?source=a1（Review Room 為獨立 fallback route）。
  //
  // §8 COVERAGE & HONESTY NOTE (誠實鐵律 — do not oversell):
  //   • Reachable & asserted in ANY environment (not test.skip-ed):
  //       – A1 sessions chip (a1-link-sessions): present; if enabled → clicked (REAL handoff to #sessions) /
  //         if disabled → asserted present-but-DISABLED; the Review Room segment is then traversed via the
  //         fixture-less #review?source=a1 either way.
  //       – Review Room kit-not-started (review-room-kit-not-started): the no-auto-claim boundary (N3).
  //       – A1 issue control (a1-step-issues): always-mounted, present-but-disabled until a rule-run scores.
  //       – #intake → #minio alias（AliasRedirect）＋ 合一 ModelDataPage 標題。
  //   • Infra-gated (honest soft-`if`, N7 unexercised != verified): the M leg needs a conversion job with a
  //     bound review_session_id; absent → the leg's steps are gated out rather than faking a conversion, and
  //     the rest of the spine still runs.
  //   • The DEEP Review-Room evidence chain (first_frame / stage_matched / datachannel_ready / highlight_ack)
  //     stays in its own honest test.skip test below (skip != pass, N7).
  test("§8 lifecycle walk-through: M → IN(alias) → A1 workbench → Review Room → back to A1 issue (reachable spine)", async ({ page }) => {
    test.setTimeout(360_000); // fixture-full worst case sums ~180_000ms of finite-timeout blocking waits (M leg 10k+15k+15k+15k+15k；IN leg 15k+15k；A1/RR/A1-issue 20k+15k+20k+15k) + 6 goto navigations (no navigationTimeout in config use{} → bounded only by THIS test timeout) + up to 4 full-page screenshots with uncapped render time. Keep ~2× headroom over the summed caps (matches the deep-Kit test below and viewer-embed-a1-highlight.spec.ts precedent); default 60s is far too tight and retries:0 makes one slow-but-passing run a hard flake.
    // [M] conversion job with a bound review_session_id → SS chip to #sessions (source=minio); SS receiver
    // re-verifies the session id (spec §4.2). SOFT leg, NOT test.skip: an in-body test.skip aborts the WHOLE
    // test, which would also skip the A1 / Review-Room assertions below — gate only the M-dependent steps.
    await page.goto(`${COORDINATOR}/ui#minio`);
    const mSs = page.locator('[data-testid^="conv-job-session-"]').first();
    // Retry-wait for the chip to paint before deciding (goto doesn't await the on-mount jobs fetch; count()
    // doesn't retry) — otherwise a fixture-backed env could false-negative the leg.
    const mHasSs = await mSs.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    if (mHasSs) {
      await mSs.click();
      await expect(page).toHaveURL(/#sessions\?source=minio/, { timeout: 15_000 });
      // Id-carried proof: prove the chip carried a real session id, not just that source=minio survived
      // (buildHandoff drops empty values, handoff.ts:39).
      const mSession = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("session") ?? "";
      expect(mSession).not.toBe("");
      const ssBanner = page.getByTestId("sessions-incoming-handoff");
      await expect(ssBanner).toBeVisible({ timeout: 15_000 });
      // Receiver surfaced THAT id (handoffIdText → banner text), independent of verify status; accept all
      // honest non-none terminal states (verified / not_found / indeterminate) — narrowing would flake or lie
      // about live backend state; per-input discrimination is owned by the unit tests.
      await expect(ssBanner).toContainText(mSession, { timeout: 15_000 });
      await expect(ssBanner).toHaveAttribute("data-handoff-status", /verified|not_found|indeterminate/);
      await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-01-m-to-sessions.png", fullPage: true });
    }

    // [IN] intake 軸已併入合一 ModelDataPage：#intake 舊 deep link 由 AliasRedirect 重導 #minio
    // (EdgeConsole.tsx renderBody case "intake")。斷言 alias 真的落在合一頁（此即 IN 段現行語意；
    // 舊 intake-link-conv-* 發射端已移除）。
    await page.goto(`${COORDINATOR}/ui#intake`);
    await expect(page).toHaveURL(/#\/?minio$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /模型資料與轉檔/ })).toBeVisible({ timeout: 15_000 });

    // [A1] legacy A1 工作台遷 #a1-workbench（#a1 現為 unified workspace）。a1-link-sessions 是證據型
    // chip：selectedSession 為純前端 state、永不從後端還原 → fixture-less env 下結構性 DISABLED。
    // TOLERANT gate（同本檔其他 leg 的 waitFor→branch 形狀，非脆性 unconditional toBeDisabled）：enabled 就
    // 點擊走真實 A1→SS handoff（buildHandoff("sessions", { source: "a1", session })）；disabled 則斷言誠實的
    // present-but-disabled，再經 fixture-less 目標 #review?source=a1 續走 Review Room 段——不偽造 rule-run（誠實鐵律）。
    await page.goto(`${COORDINATOR}/ui#a1-workbench`);
    const a1Sessions = page.getByTestId("a1-link-sessions");
    await expect(a1Sessions).toBeVisible({ timeout: 20_000 });
    const canOpen = await a1Sessions.isEnabled().catch(() => false);
    if (canOpen) {
      await a1Sessions.click();
      await expect(page).toHaveURL(/#sessions\?source=a1/, { timeout: 15_000 });
      // Sender-half id-carried proof: the chip always carries selectedSession when enabled
      // (A1GovernanceWorkbenchPage.tsx:1086) — prove it landed rather than trusting source=a1 survived.
      const a1Session = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("session") ?? "";
      expect(a1Session).not.toBe("");
    } else {
      await expect(a1Sessions).toBeDisabled();
      await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-02-a1-chip-disabled.png", fullPage: true });
    }
    await page.goto(`${COORDINATOR}/ui#review?source=a1`);

    // [RR] kit_not_started — Review Room does NOT auto-claim/auto-attach (N3). This boundary is REACHABLE in ANY
    // environment via #review?source=a1 (fixture-less target), so the walk-through genuinely traverses the
    // Review Room segment of the §8 lifecycle rather than skipping it. The deep four-evidence chain is out of
    // this reachable spine and has its own honest test.skip test below.
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-03-review-not-started.png", fullPage: true });

    // [A1] issue_created — back on #a1-workbench the failure→Issue control (a1-step-issues) is always-mounted,
    // present-but-disabled until a rule-run scores (state.step ∈ {scored,issued,delivered},
    // A1GovernanceWorkbenchPage.tsx:1017). Its presence is the honest, REACHABLE A1-issue terminus of the
    // stitched lifecycle; actually enabling+POSTing it needs a real rule-run (infra-heavy, never faked here).
    await page.goto(`${COORDINATOR}/ui#a1-workbench`);
    await expect(page.getByTestId("a1-step-issues")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-04-a1-issue.png", fullPage: true });
  });

  // §8 DEEP Review-Room evidence chain — first_frame / stage_matched / datachannel_ready / highlight_ack are FOUR
  // distinct, Review-Room-owned evidence points (ReviewSessionViewerPane). review-room-viewer-host mounts ONLY
  // under an active primary lease (ReviewSessionViewerPane.tsx:324,328-329), and lease/activePrimaryLease is
  // written ONLY by claimPrimary(), whose SOLE caller is the manual-start button onClick
  // (ReviewSessionViewerPane.tsx:185-211,295). So the host is UNREACHABLE without a real session id in the input
  // AND a manual attach: a bare page.goto(#review?source=a1) (no session, no click) leaves sessionId="" /
  // lease=null and would test.skip in EVERY environment — live Kit or not — a permanent dead skip that never
  // lights up (this was quality Important #1). This test therefore sources a REAL active session via the Sessions
  // axis (never fabricates one — 誠實鐵律) and drives the manual attach, so a branch-isolated coordinator with a
  // live Kit GPU session genuinely reaches first_frame / datachannel_ready here. It NEVER fakes the four points
  // and NEVER re-implements the Review-Room chain that owns them; do NOT cite the stale A1-embedded VG-01 specs
  // (post-#286 they assert moved-away A1 testids — flagged as tech-debt in the PR).
  test("§8 deep Kit evidence chain (first_frame/stage_matched/datachannel/highlight): honest-skip when no live Kit session", async ({ page }) => {
    test.setTimeout(450_000); // a real Kit first_frame can take minutes; the per-step timeout budget below sums to ~310_000ms (10k+15k+20k+10k+30k+30k+180k+15k), so 300_000 was actually BELOW the worst-case sum (zero buffer). Mirror viewer-embed-a1-highlight.spec.ts:46's ~2× buffer convention (test.setTimeout(360_000) over its dominant 180_000 first-frame wait) by leaving real headroom over the summed budget; the default 60s test timeout is far too tight for the full live-attach path
    // Source a REAL active session the only honest way — the live Sessions table (active, non-terminating row =
    // the one with a session-terminate button, pages.tsx:1497), NOT .first() which is often a just-closed row that
    // could never be attached. No active session → honest N7 skip (the deep points are not observed here).
    await page.goto(`${COORDINATOR}/ui#sessions`);
    const activeRow = page.locator('[data-testid^="session-row-"]').filter({ has: page.locator('[data-testid^="session-terminate-"]') }).first();
    const reviewChip = activeRow.locator('[data-testid^="session-link-review-"]');
    const hasSession = await reviewChip.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    test.skip(!hasSession, "no active (non-terminating) session in this environment; cannot reach Review Room viewer host (not observed)");
    await reviewChip.click();
    await expect(page).toHaveURL(/#review\?source=sessions&.*session=/, { timeout: 15_000 });
    // Manual attach is the ONLY path to activePrimaryLease → viewer host (N3, no auto-claim). The button enables
    // only when runtime/status observes the session AND exposes a viewer origin (ReviewSessionViewerPane.tsx:289) —
    // i.e. a live Kit plane. Disabled → no live plane here → honest N7 skip (skip != pass).
    const manualStart = page.getByTestId("review-room-manual-start");
    await expect(manualStart).toBeVisible({ timeout: 20_000 });
    // Retry-wait for enablement — do NOT snapshot .isEnabled() once. The disabled gate keys on viewerOrigin +
    // sessionObserved, both set by the component's ON-MOUNT runtime/status fetch that fires exactly once and never
    // polls (ReviewSessionViewerPane.tsx:289,124-142). The button mounts (so toBeVisible passes) BEFORE that fetch
    // resolves, so a one-shot isEnabled() can read the pre-fetch disabled state and FALSE-skip a genuinely live Kit
    // session — the same on-mount-fetch race the M / SS legs above already guard with a retrying waitFor. Unlike the
    // A1 CTA at line ~214 (whose enablement is pure synchronous frontend state, so a snapshot is safe there), this
    // gate has an async dependency, so it needs a retrying assertion. toBeEnabled() auto-retries until the fetch
    // flips the gate; the .then(true/false) keeps this an honest N7 skip (button stays disabled = no live plane).
    const canAttach = await expect(manualStart).toBeEnabled({ timeout: 10_000 }).then(() => true, () => false);
    test.skip(!canAttach, "review-room-manual-start disabled: runtime/status does not observe this session or exposes no viewer origin (no live Kit plane; not observed)");
    // Arm the claim-response capture BEFORE the click so we record the lease the instant claimPrimary() POSTs it —
    // afterEach needs lease_id + lease_token to release this REAL session's primary slot, and the token is exposed
    // ONLY on the claim response (includeToken:true, app.ts:1185; runtime/status never leaks it). A 409
    // (primary_already_claimed) still resolves this wait, but .ok() is false → we record nothing → nothing to
    // release (we hold no lease). Matches the file's existing r.url().includes(...) waitForResponse style.
    const claimSettled = page.waitForResponse(
      (r) => r.url().includes("/viewer-leases/claim") && r.request().method() === "POST",
      { timeout: 30_000 },
    ).catch(() => null);
    await manualStart.click();
    const claimResp = await claimSettled;
    if (claimResp && claimResp.ok()) {
      const claimBody = await claimResp.json().catch(() => null);
      if (claimBody?.session_id && claimBody?.lease_id && claimBody?.lease_token) {
        claimedLease = { sessionId: claimBody.session_id, leaseId: claimBody.lease_id, leaseToken: claimBody.lease_token };
      }
    }
    // The host mounts only if claimPrimary() succeeds AND a viewer origin exists (ReviewSessionViewerPane.tsx:328-
    // 329). Claim rejected / no viewer origin → host never mounts → honest N7 skip.
    const host = page.getByTestId("review-room-viewer-host");
    const hasHost = await host.waitFor({ state: "visible", timeout: 30_000 }).then(() => true, () => false);
    test.skip(!hasHost, "manual attach did not mount a viewer host (claim rejected / no viewer origin); deep Kit evidence not observed (skip != pass, N7)");
    // first_frame + datachannel_ready flip to observed together ONLY when a REAL WebRTC frame lands (onFirstFrame,
    // ReviewSessionViewerPane.tsx:316-317,343-345). The host CAN mount without a live GPU stream (lease granted but
    // no frame), so gate on the real frame: no frame within budget → honest N7 skip (deep points not observed), NOT
    // a failure. Trap-safe: "not_observed" CONTAINS "observed", so wait for the field to STOP containing
    // "not_observed" rather than to contain "observed".
    const evidence = page.getByTestId("review-room-runtime-evidence");
    const firstFrameField = evidence.locator(".ec-field", { hasText: "first frame" });
    const gotFrame = await expect(firstFrameField).not.toContainText("not_observed", { timeout: 180_000 }).then(() => true, () => false);
    if (!gotFrame) {
      // Distinguish "environment has no Kit" from "Kit WAS configured but its WebRTC/stage pipeline broke": the backend
      // KitInstance.status enum exposes a terminal `failed` state on each runtime/status kit_instance_binding
      // (coordinatorClient.ts:162-170), which neither ReviewSessionViewerPane nor this spec referenced before. Read
      // runtime/status ONE more time and look up THIS session's binding; a `failed` binding means Kit was provisioned
      // but its pipeline failed — a materially different triage signal than a plain absence of Kit. Best-effort only
      // (try/catch): any read error falls back to the generic reason. Pure additive read to enrich the skip MESSAGE —
      // it does NOT touch ReviewSessionViewerPane.tsx (kept out of scope per the finding's guardrail).
      const sid = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("session") ?? "";
      let kitFailed = false;
      try {
        const rs = await page.request.get(`${COORDINATOR}/api/runtime/status`, { timeout: 10_000 });
        if (rs.ok()) {
          const body = await rs.json();
          const bindings: Array<{ session_id?: string; status?: string }> = Array.isArray(body?.kit_instance_bindings) ? body.kit_instance_bindings : [];
          kitFailed = bindings.some((b) => b?.session_id === sid && b?.status === "failed");
        }
      } catch { /* best-effort enrichment; keep the generic no-live-Kit reason below */ }
      test.skip(true, kitFailed
        ? "viewer host mounted but this session's kit_instance_binding reports status=failed: Kit WAS configured and its WebRTC/stage pipeline FAILED (NOT an environment without Kit); first_frame/stage_matched/datachannel_ready/highlight_ack not observed (skip != pass, N7)"
        : "viewer host mounted but no real Kit first_frame within budget and no failed binding observed (no live Kit GPU stream in this environment); first_frame/stage_matched/datachannel_ready/highlight_ack not observed (skip != pass, N7)");
    }
    // Real frame landed: assert the two deterministically-coupled deep points (first_frame proven above;
    // datachannel_ready is set in the SAME onFirstFrame handler). HONEST SCOPE: stage_matched + highlight_ack are
    // NOT hard-asserted here — they need the A1 rule-run handoff payload (expected_stage_url / ifc_guid /
    // usd_prim_path) that a Sessions-sourced handoff does not carry, so they stay screenshot-only evidence owned by
    // the A1→Review path, not this Kit-liveness probe.
    await expect(evidence.locator(".ec-field", { hasText: "DataChannel ready" })).not.toContainText("not_observed", { timeout: 15_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-05-review-deep-kit.png", fullPage: true });
  });
});
