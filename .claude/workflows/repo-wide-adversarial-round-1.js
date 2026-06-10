export const meta = {
  name: 'repo-wide-adversarial-round-1',
  description: 'merged main repo-wide 多 agent 對抗驗證（coordinator/governance/viewer/honest）→ 對抗確認真偽',
  phases: [
    { title: 'Review', detail: '並行 4 lens：coordinator 安全/邊界、governance 正確/安全、viewer 狀態機/邊界、誠實降級全域' },
    { title: 'Verify', detail: 'high/blocker 對抗確認（預設懷疑）' },
  ],
}

const FIND = {
  type: "object",
  properties: {
    lens: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["blocker", "high", "medium", "low"] },
          file: { type: "string" },
          title: { type: "string" },
          detail: { type: "string" },
          fix: { type: "string" },
        },
        required: ["severity", "file", "title", "detail", "fix"],
        additionalProperties: false,
      },
    },
  },
  required: ["lens", "findings"],
  additionalProperties: false,
}

const COMMON = `repo C:\\Repos\\active\\iot\\AI-BIM-governance（merged main，含 fe-redesign CH-0~H + 問題分頁）。只讀。
回**真實會發生**的 findings（嚴格 severity：blocker=生產壞/安全洞，high=明確 bug/邊界違規/誠實違規，medium/low=次要）。無問題回空陣列、不硬湊。每筆給 file:line + 具體 detail + 可行 fix。`

phase('Review')

const reviews = await pipeline(
  [
    { key: 'coord-security', prompt: `${COMMON}\n【lens: coordinator 安全/邊界】審 bim-review-coordinator/src（app.ts + routes/）：dev 路由(/api/dev/*)授權(ENABLE_DEV_ROUTES/loopback)、/api/kit/* 變更型授權(x-dev-token)、ifc-file loopback-only、/api/dev/ifc-sources 不洩絕對路徑、/ui 服務(static/SPA fallback 不吞 /ui/open)、governance proxy for-session 的 session/guid 守門、ifc-ready intake webhook secret/IP allowlist、path traversal、secret 洩漏到回應。找真實安全/邊界洞。` },
    { key: 'gov-correctness', prompt: `${COMMON}\n【lens: governance-service 正確/安全】審 governance-service（app.py rule-run/diff/federation/element-semantics/spatial-tree + rule_engine/）：任意 ifc_source_path open（path traversal；緩解=loopback+coordinator resolve?）、ifcopenshell 例外/奇異元素處理、JSON 序列化(enum/entity 值)、_spatial_subtree/_spatial_chain 迴圈終止、get_psets 合成 key、rule predicate 正確性、SQL/檔案注入。找真實正確/安全問題。` },
    { key: 'viewer-statemachine', prompt: `${COMMON}\n【lens: viewer 狀態機/邊界】審 web-viewer-sample/src（Window.tsx + AppStream + harness/ + console/viewer/）：harness 旗標洩漏到 prod(harnessConfig)、viewerTab/MockViewport/GovernanceOverlay 分頁 gate 邏輯、spectator 三層權威(不送 mutating)、前端是否只打 :8004(各 fetch target)、WebRTC 生命週期/reconnect、_hasRemoteVideoFrame gate、競態(useEffect reqRef)。找真實 bug/邊界違規。` },
    { key: 'honest-degradation', prompt: `${COMMON}\n【lens: 誠實降級全域】跨 coordinator/governance/viewer 找違反誠實鐵律：捏造數值/假成功/靜默失敗/把 fake 當真/mock 覆蓋真資料/缺資料顯有把握值/disabled 按鈕假裝可用/coverage 自算誤導/未對映 usd_prim_path 捏造。重點查 fe-redesign 新碼 + mapping fake-vs-real 隔離。找真實誠實違規。` },
  ],
  (d) => agent(d.prompt, { label: `review:${d.key}`, phase: 'Review', schema: FIND, model: 'opus' }),
  (review, d) => parallel((review.findings || []).filter((f) => f.severity === 'blocker' || f.severity === 'high').map((f) => () =>
    agent(`${COMMON}\n對抗確認此 finding 真偽（預設懷疑，可能 false positive；讀實際碼+緩解機制確認）：\n[${f.severity}] ${f.file} — ${f.title}\n${f.detail}\n建議修：${f.fix}\n回 {real:boolean, reason, severity_adjusted}。`,
      { label: `verify:${d.key}`, phase: 'Verify', model: 'opus',
        schema: { type: "object", properties: { real: { type: "boolean" }, reason: { type: "string" }, severity_adjusted: { type: "string" } }, required: ["real", "reason"], additionalProperties: false } })
      .then((v) => ({ ...f, lens: d.key, verdict: v }))
  )),
)

const flat = reviews.flat().filter(Boolean)
const confirmed = flat.filter((f) => f.verdict && f.verdict.real)
return { confirmedHighBlocker: confirmed, verifiedCount: flat.length }
