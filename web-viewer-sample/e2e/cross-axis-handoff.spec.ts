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
    const recordsSettled = page.waitForResponse((r) => r.url().includes("/api/conversion/records?limit=50"), { timeout: 15_000 }).catch(() => null);
    await convChip.click();
    await expect(page).toHaveURL(/#conv\?source=minio/, { timeout: 15_000 });
    // quality Important #1: the title claims the chip "carries a real minio_key" — PROVE that, not just that
    // source=minio survived. buildHandoff drops empty values (handoff.ts:39) and minio_key is optional in
    // parseHandoff (handoff.ts:51-53), so a chip that forgot obj.key still yields a non-null handoff whose CV
    // verify falls through to not_found (pages.tsx:917,921) — indistinguishable from a real key with no ledger
    // record. Extract the id from the hash (mirrors the SS→Review leg below) and assert non-empty so a
    // dropped-minio_key wiring regression fails here instead of passing silently.
    const minioKey = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("minio_key") ?? "";
    expect(minioKey).not.toBe("");
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
    // Receiver-side half of the id-carried proof (analogue of SS→Review asserting the evidence block echoes
    // ssSession): handoffIdText renders minio_key into the banner text for a source=minio handoff regardless of
    // verify status (incomingHandoff.tsx:35,44-47), so this catches a receiver that surfaced a blank / wrong id.
    // Orthogonal to the verify-status discrimination noted above — a not_found banner still contains the id.
    await expect(banner).toContainText(minioKey, { timeout: 15_000 });
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
    test.setTimeout(360_000); // fixture-full worst case = 14 sequential finite-timeout blocking waits (measured, not the ~10 an earlier draft guessed): M leg 70_000 (10_000 chip waitFor + 15_000 URL + 15_000 banner visible + 15_000 banner text + 15_000 untimed toHaveAttribute) + IN leg 70_000 (same shape) + A1/Review-Room/A1-issue 70_000 (20_000 CTA visible + 15_000 untimed toBeDisabled + 20_000 kit-not-started + 15_000 a1-step-issues) = 210_000ms. The untimed assertions (lines 212/247/276) inherit the config expect timeout 15_000 (playwright.config.ts:29), not a negligible value; the two waitForResponse (lines 196/231) are armed BEFORE their leg's later awaits so they are ~fully elapsed by their await site → ~0 added. On TOP of the 210_000 sum sit 5 page.goto navigations (no navigationTimeout in config use{} → bounded only by THIS test timeout, playwright.config.ts:37-43) + 3 full-page screenshots whose fetch/render time is uncapped, so the budget must sit well above 210_000. 360_000 ≈ 1.7× the summed caps = real headroom (the deep-Kit test below measures its own budget the same way; matches the viewer-embed-a1-highlight.spec.ts:46 test.setTimeout(360_000) precedent). The default 60s test timeout (playwright.config.ts:28) is far too tight, and retries:0 (playwright.config.ts:32) means one slow-but-passing run = a hard flake — exactly the failure this budget guards.
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
      const convRecordsSettled = page.waitForResponse((r) => r.url().includes("/api/conversion/records?limit=50"), { timeout: 15_000 }).catch(() => null);
      await mConv.click();
      await expect(page).toHaveURL(/#conv\?source=minio/, { timeout: 15_000 });
      // Same id-carried proof as the isolated M→CV test above (quality Important #1): prove the chip carried a
      // real minio_key, not just that source=minio survived — a dropped key still yields a non-null handoff that
      // CV verifies to not_found, visually identical to a real miss.
      const mMinioKey = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("minio_key") ?? "";
      expect(mMinioKey).not.toBe("");
      const convBanner = page.getByTestId("conv-incoming-handoff");
      await expect(convBanner).toBeVisible({ timeout: 15_000 });
      // Receiver surfaced THAT id (handoffIdText → banner text, incomingHandoff.tsx:35,44-47), independent of verify status.
      await expect(convBanner).toContainText(mMinioKey, { timeout: 15_000 });
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
      const inRecordsSettled = page.waitForResponse((r) => r.url().includes("/api/conversion/records?limit=50"), { timeout: 15_000 }).catch(() => null);
      await inConv.click();
      await expect(page).toHaveURL(/#conv\?source=intake/, { timeout: 15_000 });
      // Same id-carried proof (quality Important #1): the intake chip carries job_id (pages.tsx:3185) — prove it
      // reached the URL rather than trusting source=intake survived; a dropped job_id still verifies to not_found
      // (pages.tsx:909,921), indistinguishable from a real miss.
      const inJobId = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("job_id") ?? "";
      expect(inJobId).not.toBe("");
      const inBanner = page.getByTestId("conv-incoming-handoff");
      await expect(inBanner).toBeVisible({ timeout: 15_000 });
      // Receiver surfaced THAT id: for a source=intake handoff handoffIdText falls through session→minio_key→job_id
      // (incomingHandoff.tsx:35), so the banner text carries job_id.
      await expect(inBanner).toContainText(inJobId, { timeout: 15_000 });
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
      // Same id-carried proof (quality Important #1, sender half): buildA1ReviewRoomHandoffHash always carries
      // session (pages.tsx:245), so prove it landed rather than trusting source=a1 survived. This branch is
      // currently unreachable (selectedSession is pure frontend, never restored from backend — see the note in
      // the else path), so the guard stays dormant until a deployment seeds a rule-run fixture and enables the
      // CTA; the receiver-side re-verify of a Review-Room session id is owned by the SS→Review test's evidence assertion.
      const a1Session = new URLSearchParams(new URL(page.url()).hash.split("?")[1] ?? "").get("session") ?? "";
      expect(a1Session).not.toBe("");
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
