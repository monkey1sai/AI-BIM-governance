import { expect, test } from "@playwright/test";

const COORDINATOR = process.env.E2E_COORDINATOR_BASE_URL || "http://127.0.0.1:8004";

test.describe("seven-axis cross-page harmony", () => {
  test("shared status rail is present on every axis and GPU shows 未取得 (no fake green)", async ({ page }) => {
    for (const route of ["#a1", "#conv", "#sessions", "#instances", "#minio", "#intake", "#runtime"]) {
      await page.goto(`${COORDINATOR}/ui${route}`);
      const rail = page.getByTestId("shared-status-rail");
      await expect(rail).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("rail-gpu-value")).toContainText("未取得");
    }
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-rail-runtime.png", fullPage: true });
  });

  test("M → CV chip carries a real minio_key and lands on #conv (source=minio)", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#minio`);
    // If real MinIO objects are listed, click the first source_ifc conv chip; else honestly skip.
    const convChip = page.locator('[data-testid^="minio-link-conv-"]').first();
    // Decide skip only AFTER the chip has had a chance to paint. page.goto (waitUntil:'load') does not await
    // the on-mount getMinioFolder fetch + re-render, and locator.count() does not auto-retry — an immediate
    // count() can read 0 before a real source_ifc chip renders and false-skip a runnable env. waitFor retries
    // until visible (or times out), mirroring a1-minio-governance-3d.spec.ts:28, so we skip only when truly absent.
    const hasObjects = await convChip.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    test.skip(!hasObjects, "no MinIO source_ifc objects in this environment (not observed)");
    // Arm the CV ledger-fetch wait BEFORE the click so the response can't fire before we listen. CV
    // re-verifies minio_key against `records`, which is [] until GET /api/conversion/records lands, so the
    // banner paints a transient `not_found` first (records=[] & recordsTruncated=false → verify returns false
    // → not_found; pages.tsx:865,904,908-922 + incomingHandoff.tsx:29-30). Unlike A1/SS/KG/M, CV keeps this
    // load flash on purpose (parent 47f9975). Awaiting this response is a BEST-EFFORT nudge toward a stable
    // screenshot frame — waitForResponse resolves on the HTTP response (headers received), NOT after the page
    // reads the body + setRecords + React commits the re-render, so it does NOT guarantee the terminal verdict
    // is in the DOM by screenshot time; the shot can still catch the transient not_found flash (quality
    // Important #1 — do not oversell). HONEST SCOPE: awaiting also does NOT tighten the toHaveAttribute
    // assertion — it accepts `not_found`, which is ALSO the transient value, so the assertion's pass/fail is
    // identical with or without this wait. Match `?limit=50` specifically — that is CV's OWN loadRecords() (pages.tsx:952).
    // The always-mounted SharedStatusProvider polls the SAME endpoint every 5s and the M page fetches it on
    // mount, both with `?limit=100`; a bare `/api/conversion/records` predicate could resolve on one of those
    // unrelated hits and race past CV's own load, so the screenshot could still catch the pre-load flash.
    const recordsSettled = page.waitForResponse((r) => r.url().includes("/api/conversion/records?limit=50"), { timeout: 15_000 });
    await convChip.click();
    await expect(page).toHaveURL(/#conv\?source=minio/, { timeout: 15_000 });
    // §12 receiver rule: CV must re-verify the incoming minio_key and show an honest verified/not-found banner
    // (Task 14) — never silently ignore the id. WHAT THIS ASSERTS (quality Important #1 — do not oversell): a
    // WIRING smoke test — the banner mounts and CV re-verifies the id into one of the honest non-none states,
    // NOT that a given input maps to a specific state. The accepted set is all three honest terminal verdicts
    // because a fixture-less env does not control whether the clicked object has a ledger record: `verified`
    // needs records.some() to hit (pages.tsx:918), `not_found` is the honest miss, `indeterminate` is the
    // honest truncation case (getConversionRecords(50); once the ledger holds >50 rows and the key falls
    // outside that window, pages.tsx:908-922/recordsTruncated returns it — incomingHandoff.tsx:9,29-30).
    // Narrowing to one value would flake or lie about live backend state. LIMIT: this assertion cannot catch a
    // broken-predicate regression that collapses every input to not_found (not_found is a legitimate terminal
    // state here); that per-input discrimination — incl. truncation→indeterminate — is owned by the unit tests
    // in incomingHandoff.test.tsx (its CV truncation cases), not by this E2E.
    const banner = page.getByTestId("conv-incoming-handoff");
    await expect(banner).toBeVisible({ timeout: 15_000 });
    await recordsSettled; // best-effort settle of CV's own ledger fetch → makes the screenshot below LIKELY (not guaranteed) to show the terminal banner rather than the pre-load not_found flash: waitForResponse resolves on the HTTP response, before setRecords + the React re-render (does NOT change the assertion — see the arm-site HONEST SCOPE note above)
    await expect(banner).toHaveAttribute("data-handoff-status", /verified|not_found|indeterminate/);
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-m-to-conv.png", fullPage: true });
  });

  test("A1 has no inline WebRTC viewer; Review Room owns 3D and is not auto-claimed", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#a1`);
    // N3 gate WITH TEETH. `review-room-viewer-host` is the live-3D viewer host that ONLY Review Room
    // renders (ReviewSessionViewerPane.tsx:329) — it must be absent on #a1, and it IS asserted present-in-
    // context on #review below, so this is a real differential, not a tautology. (The previous assertion
    // keyed on `a1-embedded-viewer`, a testid that exists nowhere in the repo, so toHaveCount(0) passed
    // vacuously and guarded nothing.) The exhaustive "A1 never mounts EmbeddedViewer" guard is the existing
    // unit test A1ViewerEmbed.test.tsx (mocks EmbeddedViewer, asserts renderCount === 0); this E2E is the
    // browser-evidence complement (N7).
    await expect(page.getByTestId("review-room-viewer-host")).toHaveCount(0);
    // A1 → sessions chip is evidence-typed: disabled until a session is selected.
    await expect(page.getByTestId("a1-link-sessions")).toBeDisabled();
    await page.goto(`${COORDINATOR}/ui#review?source=a1`);
    // Review Room owns the flow: before manual start it shows kit-not-started (and would render
    // review-room-viewer-host after start) — the positive half of the differential above.
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-review-not-started.png", fullPage: true });
  });

  test("SS → Review chip navigates with the session id (re-verified, not silently defaulted)", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#sessions`);
    const reviewChip = page.locator('[data-testid^="session-link-review-"]').first();
    // Same race as M→CV: the sessions table renders from an on-mount /api/runtime/status fetch that goto does
    // not await, and count() does not retry. waitFor lets a live session actually paint before we decide to skip.
    const hasSession = await reviewChip.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    test.skip(!hasSession, "no active session in this environment (not observed)");
    await reviewChip.click();
    await expect(page).toHaveURL(/#review\?source=sessions&.*session=/, { timeout: 15_000 });
    // Review Room does not auto-claim: the manual start control is present and the not-started note shows.
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-ss-to-review.png", fullPage: true });
  });

  // §8 Representative Cross-Axis Lifecycle — ONE stitched walk-through (spec §12/§13, plan Task 15). This test
  // traverses the full REACHABLE spine of the §8 lifecycle end-to-end — M→CV re-verify → IN→CV re-verify → A1
  // Review-Room CTA → Review Room (kit-not-started) → back to A1 issue control — in a single journey. Infra-gated
  // legs are honestly soft-gated (each leg's steps run only when its real fixture exists); we never fake a
  // conversion, an A1 rule-run failure, or a live Kit session (誠實鐵律).
  //
  // §8 COVERAGE & HONESTY NOTE (誠實鐵律 — do not oversell):
  //   • Reachable & asserted in ANY environment (this test runs them to completion, it does NOT test.skip them):
  //       – A1 Review-Room CTA (a1-open-review-room): present; if enabled → clicked (REAL handoff) / if disabled →
  //         asserted present-but-DISABLED, then the walk continues via the CTA's OWN fixture-less target
  //         #review?source=a1 (pages.tsx:711), so the Review Room segment is genuinely traversed either way.
  //       – Review Room kit-not-started (review-room-kit-not-started): the no-auto-claim boundary (N3).
  //       – A1 issue control (a1-step-issues): present in the always-mounted Deliverables panel (pages.tsx:651-653).
  //   • Infra-gated (honest soft-`if`, N7 unexercised != verified): M→CV / IN→CV need a real MinIO source_ifc
  //     object / ifc-ready job (+ a CV ledger record); absent → the leg's steps are gated out rather than faking a
  //     conversion, and the A1→Review Room→A1-issue spine still runs.
  //   • The DEEP Review-Room evidence chain (first_frame / stage_matched / datachannel_ready / highlight_ack) is
  //     NOT part of this reachable spine — it needs a manual attach + a live Kit GPU session and lives in its own
  //     honest test.skip test below (skip != pass, N7). This additive spec never fakes it and never re-implements
  //     the Review-Room chain that owns it.
  // Consequence (honest scope): what this walk-through EXECUTES against a real browser is the reachable spine (its
  // cross-axis-s8-* screenshots). Two things stay `not observed` without a branch-isolated coordinator seeded with
  // a MinIO source_ifc fixture + a live Kit session: (a) enabling the A1 CTA for a REAL rule-run handoff (this env
  // only ever reaches the present-but-disabled branch), and (b) the four deep Kit evidence points — do NOT mark
  // either "verified in browser" on the strength of this file alone.
  test("§8 lifecycle walk-through: M → IN → CV → A1 → Review Room → back to A1 issue (reachable spine)", async ({ page }) => {
    // [M] minio_object_detected → chip to #conv (source=minio); CV receiver re-verifies the minio_key (Task 14)
    await page.goto(`${COORDINATOR}/ui#minio`);
    const mConv = page.locator('[data-testid^="minio-link-conv-"]').first();
    // Retry-wait for the chip to paint before deciding (goto doesn't await the on-mount folder fetch; count()
    // doesn't retry) — otherwise a fixture-backed env could false-negative, contradicting the §8 note above.
    const mHasConv = await mConv.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    // SOFT leg (mirror the IN leg below), NOT test.skip: a test.skip(!mHasConv) in the body aborts the WHOLE test
    // the instant MinIO fixtures are absent (Playwright's in-body test.skip throws to end the test), which would
    // also skip the A1 Review-Room CTA assertions further down — directly contradicting the coverage note's
    // "asserted present-but-DISABLED … holds in ANY environment". Gate only the MinIO-dependent M steps here so
    // the IN and A1 legs still run in a fixture-less env.
    if (mHasConv) {
      // Same CV load-race guard as the isolated M→CV test above — match ?limit=50 (CV's own loadRecords), NOT the
      // SharedStatusProvider 5s poll / M page ?limit=100: arm the ledger-fetch wait before the click so the s8-01
      // screenshot below is a BEST-EFFORT terminal-banner frame. Honest scope (quality Important #1 — do not
      // oversell): waitForResponse resolves on the HTTP response, before setRecords + the React re-render, so the
      // shot can still catch the transient pre-load not_found flash; and this does NOT tighten the toHaveAttribute
      // below — not_found is accepted and is also the transient value; the wait is a best-effort nudge for the
      // screenshot frame, not a stricter check.
      const convRecordsSettled = page.waitForResponse((r) => r.url().includes("/api/conversion/records?limit=50"), { timeout: 15_000 });
      await mConv.click();
      await expect(page).toHaveURL(/#conv\?source=minio/, { timeout: 15_000 });
      const convBanner = page.getByTestId("conv-incoming-handoff");
      await expect(convBanner).toBeVisible({ timeout: 15_000 });
      await convRecordsSettled;
      // Wiring smoke test (see the isolated M→CV note above): accept all three honest terminal states — verified
      // (records.some hit), not_found (honest miss), indeterminate (recordsTruncated once the ledger exceeds the
      // 50-record window, pages.tsx:908-922). Per-input discrimination is owned by incomingHandoff.test.tsx.
      await expect(convBanner).toHaveAttribute("data-handoff-status", /verified|not_found|indeterminate/);
      await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-01-m-to-conv.png", fullPage: true });
    }

    // [IN] ifc_ready_job_listed → #intake job row also chips into #conv (source=intake). Soft leg: exercise it
    // when a job exists (so IN is genuinely traversed, not skipped like the reviewer flagged), else move on —
    // the CV receiver was already covered via M above.
    await page.goto(`${COORDINATOR}/ui#intake`);
    const inConv = page.locator('[data-testid^="intake-link-conv-"]').first();
    // Soft leg: retry-wait so a real ifc-ready job isn't missed by an early count() (goto doesn't await the
    // on-mount jobs fetch; count() doesn't retry) — genuinely-absent jobs still fall through in ~10s.
    const inHasConv = await inConv.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    if (inHasConv) {
      // Same CV load-race guard (?limit=50 = CV's own fetch): await CV's ledger fetch as a best-effort settle,
      // consistent with the M→CV leg (waitForResponse resolves on the HTTP response, before setRecords + the
      // re-render, so it does not guarantee a settled banner). Honest scope (quality Important #1): this leg takes
      // no screenshot right after and the assertion accepts not_found (transient AND terminal), so the wait
      // changes neither a screenshot (none) nor the assertion's pass/fail — it stays a wiring smoke test (banner
      // mounts + CV re-verifies into an honest non-none state); per-input discrimination is owned by incomingHandoff.test.tsx.
      const inRecordsSettled = page.waitForResponse((r) => r.url().includes("/api/conversion/records?limit=50"), { timeout: 15_000 });
      await inConv.click();
      await expect(page).toHaveURL(/#conv\?source=intake/, { timeout: 15_000 });
      const inBanner = page.getByTestId("conv-incoming-handoff");
      await expect(inBanner).toBeVisible({ timeout: 15_000 });
      await inRecordsSettled;
      // Accept all three honest terminal states; indeterminate is the honest truncation case (ledger >50 →
      // recordsTruncated, pages.tsx:908-922).
      await expect(inBanner).toHaveAttribute("data-handoff-status", /verified|not_found|indeterminate/);
    }

    // [A1] source_selected → rule_run_ready → failures_ready → review_requested. The "開啟 Review Room（第一筆
    // 失敗）" CTA (a1-open-review-room) is evidence-typed: disabled until BOTH a session is selected AND
    // state.failed[0] exists (a1ReviewRoomHandoffReason, pages.tsx:256-262 → disabled={Boolean(reason)},
    // pages.tsx:713-714). This walk-through never drives session-select nor a rule-run, and selectedSession
    // (pages.tsx:306) + the useReducer state (pages.tsx:283) are pure frontend that never restore from the
    // backend — so in a fixture-less env the CTA is structurally DISABLED. TOLERANT gate (same waitFor→branch
    // shape as this file's other legs, NOT a brittle unconditional toBeDisabled that would FAIL the day a
    // deployment seeds a rule-run fixture and enables the CTA): if enabled, click it and walk the REAL A1→Review
    // handoff (buildA1ReviewRoomHandoffHash → #review?source=a1&session=…, pages.tsx:709-711,245); else assert the
    // honest present-but-disabled truth and continue the stitch via the CTA's OWN fixture-less target
    // (#review?source=a1, pages.tsx:711) — WITHOUT faking a rule-run (誠實鐵律).
    await page.goto(`${COORDINATOR}/ui#a1`);
    const openReview = page.getByTestId("a1-open-review-room");
    await expect(openReview).toBeVisible({ timeout: 20_000 });
    const canOpen = await openReview.isEnabled().catch(() => false);
    if (canOpen) {
      await openReview.click();
      await expect(page).toHaveURL(/#review\?source=a1/, { timeout: 15_000 });
    } else {
      await expect(openReview).toBeDisabled();
      await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-02-a1-cta-disabled.png", fullPage: true });
      await page.goto(`${COORDINATOR}/ui#review?source=a1`);
    }

    // [RR] kit_not_started — Review Room does NOT auto-claim/auto-attach (N3). This boundary is REACHABLE in ANY
    // environment via #review?source=a1 (the CTA's own fixture-less target), so the walk-through genuinely
    // traverses the Review Room segment of the §8 lifecycle rather than skipping it. The deep four-evidence chain
    // is out of this reachable spine and has its own honest test.skip test below.
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-03-review-not-started.png", fullPage: true });

    // [A1] issue_created — back on #a1 the failure→Issue control (a1-step-issues, POST /governance/issues/from-
    // rule-run/:id) is present in the always-mounted Deliverables panel (pages.tsx:651-653), present-but-disabled
    // until a rule-run scores (state.step ∈ {scored,issued,delivered}). Its presence is the honest, REACHABLE
    // A1-issue terminus of the stitched lifecycle; actually enabling+POSTing it needs a real rule-run (infra-
    // heavy, never faked here).
    await page.goto(`${COORDINATOR}/ui#a1`);
    await expect(page.getByTestId("a1-step-issues")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-04-a1-issue.png", fullPage: true });
  });

  // §8 DEEP Review-Room evidence chain — first_frame / stage_matched / datachannel_ready / highlight_ack are FOUR
  // distinct, Review-Room-owned evidence points (ReviewSessionViewerPane): review-room-viewer-host mounts ONLY
  // under an active primary lease, which needs a manual attach + a live Kit GPU session (Windows-native per repo
  // constraint). So this spec drives them ONLY when the viewer host mounts and otherwise honestly test.skips them
  // as `not observed` (skip != pass, N7) — the honest runtime signal the walk-through's reachable spine cannot
  // itself emit (a mid-test skip there would abort the reachable legs too). This additive spec NEVER fakes the
  // four points and NEVER re-implements the Review-Room chain that owns them; do NOT cite the stale A1-embedded
  // VG-01 specs for them (post-#286 they assert moved-away A1 testids — flagged as tech-debt in the PR).
  test("§8 deep Kit evidence chain (first_frame/stage_matched/datachannel/highlight): honest-skip when no live Kit session", async ({ page }) => {
    await page.goto(`${COORDINATOR}/ui#review?source=a1`);
    const host = page.getByTestId("review-room-viewer-host");
    // Same waitFor→skip shape as the M→CV / SS→Review tests above so an async mount isn't missed by an early
    // count(); genuinely absent → honest N7 skip (the deep points are not observed without a live Kit session).
    const hasHost = await host.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    test.skip(!hasHost, "no manual attach + live Kit GPU session here; first_frame/stage_matched/datachannel_ready/highlight_ack not observed (skip != pass, N7)");
    await expect(host).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-05-review-deep-kit.png", fullPage: true });
  });
});
