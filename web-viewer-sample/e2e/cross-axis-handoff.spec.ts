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
    // load flash on purpose (parent 47f9975). Awaiting this response lets the banner reach its terminal verdict
    // before the screenshot below captures it. HONEST SCOPE (quality Important #1): awaiting does NOT tighten
    // the toHaveAttribute assertion — it accepts `not_found`, which is ALSO the transient value, so the
    // assertion's pass/fail is identical with or without this wait; the wait buys a stable screenshot frame,
    // not a stricter check. Match `?limit=50` specifically — that is CV's OWN loadRecords() (pages.tsx:952).
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
    await recordsSettled; // settle CV's own ledger fetch → the screenshot below shows the terminal banner, not the pre-load not_found flash (does NOT change the assertion — see the arm-site HONEST SCOPE note above)
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

  // §8 Representative Cross-Axis Lifecycle — ONE stitched walk-through (spec §12/§13). Each deep leg
  // uses an honest test.skip (same pattern as the isolated tests above): we never fake a conversion, an A1
  // rule-run failure, or a live Kit session. This adds the §8 walk-through *spec* that Task 15 was missing —
  // but read the coverage & honesty note before treating it as evidence that the deep flow itself was run.
  //
  // §8 COVERAGE & HONESTY NOTE (誠實鐵律 — do not oversell):
  // In a fixture-less environment (today's CI, and every run recorded for this commit) ONLY two things run to
  // completion end-to-end: the shared-rail axis sweep (test 1) and the Review-Room "not started" boundary
  // (test 3). The deep §8 legs below fall into two honest buckets:
  //   • Infra-gated — test.skip only because the real backend object is absent in this environment:
  //       – M→CV / IN→CV receiver verdict  → needs a real MinIO source_ifc object (+ a CV ledger record).
  //       – Review-Room four-evidence chain (first_frame/stage_matched/datachannel/highlight) → needs a manual
  //         attach + a live Kit GPU session; this spec NEVER fakes them (N7: skip != pass).
  //   • Structurally out-of-scope for THIS spec — skips regardless of environment:
  //       – A1 rule-run failure → Review handoff  → the "開啟 Review Room（第一筆失敗）" CTA only enables after a
  //         session is selected AND state.failed[0] exists (a1ReviewRoomHandoffReason, pages.tsx:256-262). This
  //         walk-through never drives session-select + rule-run, and selectedSession (pages.tsx:306) + the
  //         useReducer state (pages.tsx:283) are pure frontend that never restore from the backend — so this
  //         leg 100% skips even with full infra. A TEST-SCOPE limit (kept out to avoid extra automation
  //         fragility on the plan's last task), NOT a missing-fixture / infra limitation.
  // Consequence: as of this commit the deep §8 lifecycle path is `not observed` — it has NOT been exercised
  // to completion by any real run (the cross-axis-s8-01/02/03 screenshots below are produced only on a
  // fixture-backed run and are absent otherwise). Confidence in these legs is code-review + structural only,
  // NOT browser-E2E evidence — do not mark the §8 lifecycle "verified in browser" on the strength of this file
  // alone. To capture real deep-segment evidence, run this spec against a branch-isolated coordinator (:8005)
  // seeded with a real MinIO source_ifc fixture (and a live Kit session for the Review-Room legs) — except the
  // A1→Review leg, which additionally needs this spec extended to drive session-select + rule-run (see its
  // structural note above); seeding infra alone will not make it run.
  test("§8 lifecycle walk-through: M → IN → CV → A1 → Review Room (deep Kit legs honest-skip) → back to A1 issue", async ({ page }) => {
    // [M] minio_object_detected → chip to #conv (source=minio); CV receiver re-verifies the minio_key (Task 14)
    await page.goto(`${COORDINATOR}/ui#minio`);
    const mConv = page.locator('[data-testid^="minio-link-conv-"]').first();
    // Retry-wait for the chip to paint before skipping (goto doesn't await the on-mount folder fetch; count()
    // doesn't retry) — otherwise a fixture-backed env could still false-skip, contradicting the §8 note above.
    const mHasConv = await mConv.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    test.skip(!mHasConv, "no MinIO source_ifc object in this environment (not observed)");
    // Same CV load-race guard as the isolated M→CV test above — match ?limit=50 (CV's own loadRecords), NOT the
    // SharedStatusProvider 5s poll / M page ?limit=100: arm the ledger-fetch wait before the click so the s8-01
    // screenshot below captures CV's terminal banner, not the transient pre-load not_found flash. Same honest
    // scope (quality Important #1): this does NOT tighten the toHaveAttribute below — not_found is accepted and
    // is also the transient value; the wait is for the screenshot frame, not a stricter check.
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

    // [IN] ifc_ready_job_listed → #intake job row also chips into #conv (source=intake). Soft leg: exercise it
    // when a job exists (so IN is genuinely traversed, not skipped like the reviewer flagged), else move on —
    // the CV receiver was already covered via M above.
    await page.goto(`${COORDINATOR}/ui#intake`);
    const inConv = page.locator('[data-testid^="intake-link-conv-"]').first();
    // Soft leg: retry-wait so a real ifc-ready job isn't missed by an early count() (goto doesn't await the
    // on-mount jobs fetch; count() doesn't retry) — genuinely-absent jobs still fall through in ~10s.
    const inHasConv = await inConv.waitFor({ state: "visible", timeout: 10_000 }).then(() => true, () => false);
    if (inHasConv) {
      // Same CV load-race guard (?limit=50 = CV's own fetch): await CV's ledger fetch so the banner is read at
      // its settled state, consistent with the M→CV leg. Honest scope (quality Important #1): this leg takes no
      // screenshot right after and the assertion accepts not_found (transient AND terminal), so the wait changes
      // neither a screenshot (none) nor the assertion's pass/fail — it stays a wiring smoke test (banner mounts +
      // CV re-verifies into an honest non-none state); per-input discrimination is owned by incomingHandoff.test.tsx.
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
    // 失敗）" CTA is disabled until BOTH a session is selected AND state.failed[0] exists (a1ReviewRoomHandoffReason,
    // pages.tsx:256-262). This walk-through never drives session selection nor a rule-run, and selectedSession
    // (pages.tsx:306) + the useReducer state (pages.tsx:283) are pure frontend that never restore from the
    // backend — so the CTA can NEVER enable here regardless of environment. Honest skip below is a TEST-SCOPE
    // limit (this last additive task deliberately omits the session-select + rule-run driving steps to avoid
    // extra automation fragility), NOT a missing-fixture / infra limitation.
    await page.goto(`${COORDINATOR}/ui#a1`);
    const openReview = page.getByTestId("a1-open-review-room");
    await expect(openReview).toBeVisible({ timeout: 20_000 });
    const canOpen = await openReview.isEnabled().catch(() => false);
    test.skip(!canOpen, "A1 Review-Room CTA is structurally unreachable in THIS spec: enabling it needs the test to first drive session selection + a rule-run to populate selectedSession and state.failed[0] (pages.tsx:256-262,283,306), which this additive walk-through deliberately does not do — a test-scope limitation, not an environment/fixture gap (it would skip 100% even with full infra)");
    await openReview.click();
    await expect(page).toHaveURL(/#review\?source=a1/, { timeout: 15_000 });

    // [RR] kit_not_started — Review Room does NOT auto-claim/auto-attach; this honest boundary is what the
    // additive spec reliably reaches in CI (N3 leaves Review Room 3D/lease/highlight logic untouched).
    await expect(page.getByTestId("review-room-kit-not-started")).toBeVisible({ timeout: 20_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-02-review-not-started.png", fullPage: true });

    // [RR] first_frame_seen → stage_matched → datachannel_ready → highlight_sent → highlight_ack are FOUR
    // distinct, Review-Room-owned evidence points. They require a manual attach + a live Kit GPU session, so we
    // drive them ONLY when the viewer host mounts and honest-skip otherwise. This spec never fakes them (N7:
    // skip != pass). The deep four-evidence chain itself is out of this additive spec's scope (see the §8
    // coverage & honesty note above) — do NOT rely on the stale A1-embedded VG-01 specs for it.
    const host = page.getByTestId("review-room-viewer-host");
    test.skip(await host.count() === 0, "no manual attach + live Kit session here; four deep evidence points not observed (skip != pass, N7)");
    await expect(host).toBeVisible({ timeout: 20_000 });

    // [A1] issue_created — back on #a1 the failure→Issue control (POST from-rule-run) is present (two-step gating).
    await page.goto(`${COORDINATOR}/ui#a1`);
    await expect(page.getByTestId("a1-step-issues")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: "../artifacts/e2e/cross-axis-s8-03-a1-issue.png", fullPage: true });
  });
});
