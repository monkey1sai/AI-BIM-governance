import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel, ProvTag } from "./components";
import {
  DiffIssueImpact,
  DiffItemRow,
  DiffOverlayResult,
  DiffStatus,
  FileProjectRow,
  FileVersionRow,
  governanceClient,
  LIBRARY_IFC_PREFIX,
  parseLibraryIfcPath,
} from "./governanceClient";
import { coordinatorClient, RuntimeSessionSummary } from "./coordinatorClient";
import { MappingCache } from "./governance/mappingCache";
import type { HighlightItem as ViewerHighlightItem, HighlightResultMessage } from "./EmbeddedViewer";
import { ReviewSessionViewerPane } from "./ReviewSessionViewerPane";
import type { ReviewSessionViewerPaneBatchGate, ReviewSessionViewerPaneHandle } from "./ReviewSessionViewerPane";
import type { ElementMappingDocument } from "../types/mapping";
// A2 F2⑥ 疊加送出摘要（console 端誠實計數；viewer 端計數另由批次 ack 帶回）。
interface A2OverlaySendSummary {
  groups: { added: number; removed: number; modified: number }; // 已裝進批次的各組筆數（console 端 mapped）
  unmappedGuids: string[]; // console 端 session mapping 解不出 usd_prim 的 GUID（誠實列數，不虛報）
  noGuidCount: number;     // diff 列缺 ifc_guid（無從對映）
  fake: boolean;           // mapping 為 fake（拒用，嚴守 fake-vs-real 隔離）
  sent: number;            // 實際送出的批次筆數（0 = 未送）
  error?: string;          // mapping 載入失敗 / viewer gate 回拒理由
}
// diff change_type → 三組疊加分組（與上表 CHANGE_TONE 同一語意：moved/property/geometry 皆屬「修改」）。
const A2_CHANGE_GROUP: Record<string, "added" | "removed" | "modified"> = {
  added: "added",
  removed: "removed",
  moved: "modified",
  property_changed: "modified",
  geometry_changed: "modified",
};
// 分組 → 協定 severity（severityToColor：error=紅 / warning=橘 / 其他=藍）。顏色只寫進
// highlightPrimsRequest payload；Kit 端現況 applied_mode="selection" 不讀 color（p15，見圖例）。
const A2_GROUP_SEVERITY = { added: "added", removed: "error", modified: "warning" } as const;

// A2 檔案庫唯一邏輯鍵（＝model_version_id 形狀 {project}/{model}/{version.name}；
// option value / library:// 識別共用）。
function libraryKeyFor(projectId: string, modelId: string, versionName: string): string {
  return `${projectId}/${modelId}/${versionName}`;
}

export function VersionDiffPage() {
  const [base, setBase] = useState("C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\許良宇圖書館建築_2026.ifc");
  const [target, setTarget] = useState("C:\\Repos\\active\\iot\\AI-BIM-governance\\storage\\許良宇圖書館建築_2026 - 轉檔測試2.ifc");
  const [diff, setDiff] = useState<DiffStatus | null>(null);
  const [diffId, setDiffId] = useState<string | null>(null);
  const [items, setItems] = useState<DiffItemRow[]>([]);
  const [impact, setImpact] = useState<DiffIssueImpact | null>(null);
  const [includeGeo, setIncludeGeo] = useState(false);
  const [overlay, setOverlay] = useState<DiffOverlayResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── A2 F2⑥：diff succeeded 後的 client 端 3D 疊加（inline viewer）──
  // 不動後端 501 apply-overlay 端點、不假成功：mapping 由 elementMappingForSession 取得、
  // 高亮經 viewer DataChannel 批次 highlightPrimsRequest（單一 request＝Kit 聯集選取）。
  const [ovSessions, setOvSessions] = useState<RuntimeSessionSummary[]>([]);
  const [ovSessionsErr, setOvSessionsErr] = useState<string | null>(null);
  const [ovSession, setOvSession] = useState("");
  const [ovGate, setOvGate] = useState<ReviewSessionViewerPaneBatchGate>({ canSend: false, reason: "" });
  const [ovBusy, setOvBusy] = useState(false);
  const [ovSend, setOvSend] = useState<A2OverlaySendSummary | null>(null);
  const [ovAck, setOvAck] = useState<HighlightResultMessage | null>(null);
  const ovPaneRef = useRef<ReviewSessionViewerPaneHandle>(null);

  // A2 檔案庫選擇器（複用 A1 IssuesRuleCenterPage 模式）：base / target 各一組
  // project→model→version 三層；選定填入對應路徑 input + 帶出 model_version_id。
  const [fsTree, setFsTree] = useState<FileProjectRow[] | null>(null);
  const [fsErr, setFsErr] = useState<string | null>(null);
  // model_version_id = "{project_id}/{model_id}/{version.name}"（供 /issue-impact 版本綁定）；
  // 手動覆寫路徑 input 後清空（誠實：手填路徑無版本綁定語意）。
  const [baseVerId, setBaseVerId] = useState("");
  const [targetVerId, setTargetVerId] = useState("");
  // 受控版本選擇（值 = 唯一邏輯鍵 {project}/{model}/{version.name}）；base / target 各一套
  // project/model/version 與「選擇器填入值」追蹤。不能用 version.path 當 option value：
  // files/tree 對瀏覽器把 path 遮蔽成 "[server-path]"（全部選項同值），受控 select 會失效、
  // 且回送遮蔽字面會讓 governance 400 "ifc_source_path not found: [server-path]"。
  // 選定時 input 填 library://{key} 邏輯識別，提交走 createDiffForLibrary 由 coordinator
  // server-side 解析真路徑；手填真實路徑分支保留原 createDiff 行為不動。
  const [baseSel, setBaseSel] = useState({ project: "", model: "", version: "" });
  const [targetSel, setTargetSel] = useState({ project: "", model: "", version: "" });

  const loadFsTree = useCallback(async () => {
    setFsErr(null);
    try {
      const t = await governanceClient.filesTree();
      setFsTree(t.projects);
    } catch (e) {
      setFsErr(String(e));
    }
  }, []);
  useEffect(() => { void loadFsTree(); }, [loadFsTree]);

  // pickBaseVersion：選定一個版本 → 填 base input 邏輯識別（library://{key}）+ 記
  // model_version_id + setSel 全套。不填 ver.path：瀏覽器拿到的是遮蔽字面 "[server-path]"。
  // 僅由 base-version select onChange（且確有對應版本）呼叫；「清空 / 換層」走 clearBaseSelection。
  const pickBaseVersion = useCallback((projectId: string, modelId: string, ver: FileVersionRow) => {
    const key = libraryKeyFor(projectId, modelId, ver.name);
    setBase(`${LIBRARY_IFC_PREFIX}${key}`);
    setBaseVerId(key);
    setBaseSel({ project: projectId, model: modelId, version: key });
  }, []);
  // clearBaseSelection：換 base project / model（或選回版本 placeholder）的單一清空入口。
  // 完整重設 selector state（project/model 由呼叫者指定、version 一律清）；只在「目前 base 值
  // 正是先前由 selector 填入的 library://{key}」時才清——手動輸入的路徑不被波及。model_version_id
  // 一律清（換層後版本綁定語意消失；手動路徑早已無 verId，再清無害）。
  // 三個 setter 各自獨立呼叫（React 18 自動 batch），不在 updater 內互相觸發 setState
  // （updater 須維持純函數契約）；以 render 快照 baseSel.version 判斷值是否為 selector 填入值。
  const clearBaseSelection = useCallback((projectId: string, modelId: string) => {
    const filledKey = baseSel.version;
    setBase((cur) => (filledKey && cur === `${LIBRARY_IFC_PREFIX}${filledKey}` ? "" : cur));
    setBaseSel({ project: projectId, model: modelId, version: "" });
    setBaseVerId("");
  }, [baseSel.version]);
  // pickTargetVersion / clearTargetSelection：target 側對稱（同上語意，獨立追蹤值）。
  const pickTargetVersion = useCallback((projectId: string, modelId: string, ver: FileVersionRow) => {
    const key = libraryKeyFor(projectId, modelId, ver.name);
    setTarget(`${LIBRARY_IFC_PREFIX}${key}`);
    setTargetVerId(key);
    setTargetSel({ project: projectId, model: modelId, version: key });
  }, []);
  const clearTargetSelection = useCallback((projectId: string, modelId: string) => {
    const filledKey = targetSel.version;
    setTarget((cur) => (filledKey && cur === `${LIBRARY_IFC_PREFIX}${filledKey}` ? "" : cur));
    setTargetSel({ project: projectId, model: modelId, version: "" });
    setTargetVerId("");
  }, [targetSel.version]);
  const baseModels = fsTree?.find((p) => p.project_id === baseSel.project)?.models ?? [];
  const baseVersions = baseModels.find((m) => m.model_id === baseSel.model)?.versions ?? [];
  const targetModels = fsTree?.find((p) => p.project_id === targetSel.project)?.models ?? [];
  const targetVersions = targetModels.find((m) => m.model_id === targetSel.model)?.versions ?? [];

  const run = useCallback(async () => {
    // 重算 diff 時同步清 inline overlay 的送出/ack 摘要——殘留上一輪的 sent/unmapped 計數
    // 會誤導「新 diff 已疊加」（viewer pane 在重算期間 unmount，舊高亮早已失效）。
    setBusy(true); setErr(null); setDiff(null); setItems([]); setImpact(null); setOverlay(null);
    setOvSend(null); setOvAck(null);
    try {
      // library://（檔案庫選定）→ coordinator /api/governance-library/diffs：瀏覽器送邏輯三段，
      // 真路徑由 coordinator server-side 解析（遮蔽字面 "[server-path]" 永不回送）。
      // 手填真實 server 路徑（兩側皆非 library://）保留原 createDiff 行為不動。
      const baseLib = parseLibraryIfcPath(base);
      const targetLib = parseLibraryIfcPath(target);
      if ((baseLib === null) !== (targetLib === null)) {
        // 誠實擋下混用：一側檔案庫邏輯識別、一側手填路徑，coordinator 無從對手填側解析/驗證，
        // 直接送 governance 只會拿到令人困惑的 400。請兩側同走檔案庫或同走手填。
        setErr(t(
          "base 與 target 需同為檔案庫選擇（library://）或同為手填 server 路徑；混用無法解析。",
          "base and target must both come from the file library (library://) or both be manually entered server paths; mixing cannot be resolved.",
        ));
        return;
      }
      const { diff_id } = baseLib && targetLib
        ? await governanceClient.createDiffForLibrary({
            base: baseLib,
            target: targetLib,
            base_model_version_id: baseVerId || undefined,
            target_model_version_id: targetVerId || undefined,
            include_geometry: includeGeo,
          })
        : await governanceClient.createDiff({
            base_ifc_path: base,
            target_ifc_path: target,
            base_model_version_id: baseVerId || undefined,
            target_model_version_id: targetVerId || undefined,
            include_geometry: includeGeo,
          });
      setDiffId(diff_id);
      let st: DiffStatus | null = null;
      for (let i = 0; i < 120; i++) {
        st = await governanceClient.getDiff(diff_id);
        if (st.status === "succeeded" || st.status === "failed") break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      setDiff(st);
      if (st && st.status === "succeeded") {
        setItems(await governanceClient.getDiffItems(diff_id));
        try { setImpact(await governanceClient.diffIssueImpact(diff_id)); } catch { /* issue-impact 選配 */ }
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }, [base, target, includeGeo, baseVerId, targetVerId]);

  // A2 疊加 session 候選（比照 ReviewSessionViewerPane 播種模式：runtimeStatus().sessions，
  // 只列可 attach 的 active/created）。只在「diff succeeded 且有 diff 構件」時抓——疊加區塊
  // 也以同條件渲染，無差異構件時不擺無意義的 session 選擇器。
  const diffSucceeded = diff?.status === "succeeded";
  const hasDiffItems = items.length > 0;
  useEffect(() => {
    if (!diffSucceeded || !hasDiffItems) return;
    let alive = true;
    coordinatorClient.runtimeStatus()
      .then((rt) => {
        if (!alive) return;
        setOvSessions(rt.sessions.items.filter((s) => s.status === "active" || s.status === "created"));
        setOvSessionsErr(null);
      })
      .catch((e) => {
        if (!alive) return;
        setOvSessions([]);
        setOvSessionsErr(String(e));
      });
    return () => { alive = false; };
  }, [diffSucceeded, hasDiffItems]);

  // 套用疊加：diff 三組 GUID → session mapping 解 usd_prim（unmapped 誠實計數）→ 單一批次
  // highlightPrimsRequest。fake mapping 一律拒用（不冒充真實對映）；全數未對映不送空批次。
  const applyInlineOverlay = useCallback(async () => {
    if (!ovSession || items.length === 0) return;
    setOvBusy(true); setOvAck(null); setOvSend(null);
    try {
      const raw = await governanceClient.elementMappingForSession(ovSession);
      const cache = MappingCache.fromDocument(raw as ElementMappingDocument, null);
      if (cache.isFake) {
        setOvSend({ groups: { added: 0, removed: 0, modified: 0 }, unmappedGuids: [], noGuidCount: 0, fake: true, sent: 0 });
        return;
      }
      const seen = new Set<string>();
      const sendItems: ViewerHighlightItem[] = [];
      const groups = { added: 0, removed: 0, modified: 0 };
      const unmappedGuids: string[] = [];
      let noGuidCount = 0;
      for (const it of items) {
        if (!it.ifc_guid) { noGuidCount += 1; continue; }
        if (seen.has(it.ifc_guid)) continue; // 同 GUID 多列（moved+property_changed）只送一次
        seen.add(it.ifc_guid);
        if (!cache.primPathForGuid(it.ifc_guid)) { unmappedGuids.push(it.ifc_guid); continue; }
        const group = A2_CHANGE_GROUP[it.change_type] ?? "modified";
        groups[group] += 1;
        sendItems.push({ ifc_guid: it.ifc_guid, severity: A2_GROUP_SEVERITY[group], label: `${it.change_type}:${it.ifc_guid}` });
      }
      if (sendItems.length === 0) {
        setOvSend({ groups, unmappedGuids, noGuidCount, fake: false, sent: 0 });
        return; // 誠實：無可對映構件 → 不送、不虛報
      }
      const res = ovPaneRef.current?.sendHighlightBatch(sendItems);
      if (!res || !res.sent) {
        setOvSend({
          groups: { added: 0, removed: 0, modified: 0 }, unmappedGuids, noGuidCount, fake: false, sent: 0,
          error: res ? res.reason : t("viewer pane 未掛載", "viewer pane not mounted"),
        });
        return;
      }
      setOvSend({ groups, unmappedGuids, noGuidCount, fake: false, sent: sendItems.length });
    } catch (e) {
      setOvSend({ groups: { added: 0, removed: 0, modified: 0 }, unmappedGuids: [], noGuidCount: 0, fake: false, sent: 0, error: String(e) });
    } finally {
      setOvBusy(false);
    }
  }, [ovSession, items]);

  const counts = diff?.summary?.counts ?? {};
  return (
    <>
      <h1>{t("模型版本差異與責任追蹤 · A2", "Model version diff and responsibility tracking · A2")}</h1>
      <p className="ec-lead">
        {t("以 IFC GlobalId 多級對齊（GlobalId → Tag → type+name+location）比對兩個 model version，標記 added / removed / moved / property changed；差異計算在 CPU 完成。", "Aligns two model versions with multi-level IFC GlobalId matching (GlobalId → Tag → type+name+location), marking added / removed / moved / property changed; the diff is computed on the CPU.")}
      </p>
      <Panel title="Diff Builder" sub={t("POST /api/governance/diffs（經 coordinator proxy → governance-service）", "POST /api/governance/diffs (via coordinator proxy → governance-service)")} prov="asbuilt">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fsErr && (
            <span className="ec-warn-note" data-testid="a2-fs-error" style={{ display: "inline-flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span>{t("檔案庫不可用", "File library unavailable")}（{fsErr}）；{t("可改用下方手動輸入路徑。", "you can manually enter a path below instead.")}</span>
              <Btn data-testid="a2-fs-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadFsTree(); }}>{t("重試載入檔案庫", "Retry loading file library")}</Btn>
            </span>
          )}
          {!fsErr && !fsTree && <span className="ec-s">{t("載入檔案庫中…（GET /api/governance/files/tree）", "Loading file library… (GET /api/governance/files/tree)")}</span>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="ec-k" style={{ minWidth: 48 }}>base</span>
            <select data-testid="a2-base-project" className="ec-btn" value={baseSel.project} disabled={!fsTree}
              onChange={(e) => clearBaseSelection(e.target.value, "")}>
              <option value="">{t("專案…", "Project…")}</option>
              {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
            </select>
            <select data-testid="a2-base-model" className="ec-btn" value={baseSel.model} disabled={!baseSel.project}
              onChange={(e) => clearBaseSelection(baseSel.project, e.target.value)}>
              <option value="">{t("模型…", "Model…")}</option>
              {baseModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
            </select>
            {/* option value = 唯一邏輯鍵（不能用 v.path：遮蔽後全部選項同為 "[server-path]"）。 */}
            <select data-testid="a2-base-version" className="ec-btn" value={baseSel.version} disabled={!baseSel.model}
              onChange={(e) => { const v = baseVersions.find((x) => libraryKeyFor(baseSel.project, baseSel.model, x.name) === e.target.value); if (v) pickBaseVersion(baseSel.project, baseSel.model, v); else clearBaseSelection(baseSel.project, baseSel.model); }}>
              <option value="">{t("版本…（選定填入路徑）", "Version… (selecting fills the path)")}</option>
              {baseVersions.map((v) => <option key={v.name} value={libraryKeyFor(baseSel.project, baseSel.model, v.name)}>{v.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="ec-k" style={{ minWidth: 48 }}>target</span>
            <select data-testid="a2-target-project" className="ec-btn" value={targetSel.project} disabled={!fsTree}
              onChange={(e) => clearTargetSelection(e.target.value, "")}>
              <option value="">{t("專案…", "Project…")}</option>
              {(fsTree ?? []).map((p) => <option key={p.project_id} value={p.project_id}>{p.project_id}</option>)}
            </select>
            <select data-testid="a2-target-model" className="ec-btn" value={targetSel.model} disabled={!targetSel.project}
              onChange={(e) => clearTargetSelection(targetSel.project, e.target.value)}>
              <option value="">{t("模型…", "Model…")}</option>
              {targetModels.map((m) => <option key={m.model_id} value={m.model_id}>{m.model_id}</option>)}
            </select>
            {/* option value = 唯一邏輯鍵（不能用 v.path：遮蔽後全部選項同為 "[server-path]"）。 */}
            <select data-testid="a2-target-version" className="ec-btn" value={targetSel.version} disabled={!targetSel.model}
              onChange={(e) => { const v = targetVersions.find((x) => libraryKeyFor(targetSel.project, targetSel.model, x.name) === e.target.value); if (v) pickTargetVersion(targetSel.project, targetSel.model, v); else clearTargetSelection(targetSel.project, targetSel.model); }}>
              <option value="">{t("版本…（選定填入路徑）", "Version… (selecting fills the path)")}</option>
              {targetVersions.map((v) => <option key={v.name} value={libraryKeyFor(targetSel.project, targetSel.model, v.name)}>{v.name}</option>)}
            </select>
          </div>
          <input data-testid="a2-base-input" className="ec-btn" style={{ width: "100%" }} value={base} onChange={(e) => { setBase(e.target.value); setBaseVerId(""); setBaseSel((s) => ({ ...s, version: "" })); }} />
          <input data-testid="a2-target-input" className="ec-btn" style={{ width: "100%" }} value={target} onChange={(e) => { setTarget(e.target.value); setTargetVerId(""); setTargetSel((s) => ({ ...s, version: "" })); }} />
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Btn primary disabled={busy} caption={t("GlobalId 多級對齊", "GlobalId multi-level matching")} onClick={run}>{busy ? t("比對中…", "Comparing…") : "Run Diff"}</Btn>
            <label className="ec-s" style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={includeGeo} onChange={(e) => setIncludeGeo(e.target.checked)} /> {t("含幾何比對（tessellation，較重）", "Include geometry comparison (tessellation, heavier)")}
            </label>
          </div>
        </div>
        {err && <p className="ec-warn-note">{t("未連線後端（proxy / governance-service 需啟動）", "Backend not connected (proxy / governance-service must be running)")}：{err}</p>}
        {diff && (
          <div className="ec-grid" style={{ marginTop: 12 }}>
            <Metric value={diff.summary?.matched ?? "—"} label="matched" />
            <Metric value={counts.added ?? 0} label="added" />
            <Metric value={counts.removed ?? 0} label="removed" tone="bad" />
            <Metric value={counts.moved ?? 0} label="moved" tone="warn" />
            <Metric value={counts.property_changed ?? 0} label="property changed" tone="warn" />
            <Metric value={counts.geometry_changed ?? 0} label="geometry changed" tone="warn" />
          </div>
        )}
        {items.length > 0 && (() => {
          // A2-W1：三色碼 map（集中單一定義，色盲可及 — 色點旁保留文字）
          const CHANGE_TONE: Record<string, string> = {
            added: "ec-diff-add",
            removed: "ec-diff-del",
            moved: "ec-diff-mod",
            property_changed: "ec-diff-mod",
            geometry_changed: "ec-diff-mod",
          };
          const shown = items.slice(0, 40);
          return (
            <>
              {items.length > 40 && (
                <p className="ec-s" style={{ marginTop: 8, color: "var(--ab-text-muted)" }}>
                  {t("顯示前 40 筆，共", "Showing first 40 of")} {items.length} {t("筆", "rows")}
                </p>
              )}
              <table className="ec-table" style={{ marginTop: 8 }}>
                <thead><tr><th>change</th><th>ifc_type</th><th>ifc_guid</th><th>summary</th></tr></thead>
                <tbody>
                  {shown.map((it, i) => (
                    <tr key={i} className={CHANGE_TONE[it.change_type] ?? ""}>
                      <td>{it.change_type}</td><td>{it.ifc_type ?? "—"}</td><td>{it.ifc_guid}</td><td>{it.change_summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          );
        })()}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <Btn caption={t("POST from-diff（綁 ifc_guid）", "POST from-diff (bound to ifc_guid)")} disabled={!diffId || items.length === 0} onClick={async () => { if (!diffId) return; try { await governanceClient.issuesFromDiff(diffId); } catch (e) { setErr(String(e)); } }}>{t("變更構件建 issue", "Create issue from changed elements")}</Btn>
          {/* [套用 3D Overlay（後端 p15）]：呼叫真實端點 POST …/apply-overlay。後端誠實回 501（p15）——
              3D 著色的可用路徑是下方「3D 疊加（inline viewer）」區塊（client highlightPrimsRequest，
              需 viewer DataChannel）。保留本鈕（改名標明後端 p15）而非移除的理由：它做真實動作
              （探測端點並誠實顯示後端回應碼），且 e2e a2-version-diff-selector.spec.ts 以本鈕的
              enable 態作為 status==="succeeded" 的唯一直接 UI gate。
              真實 gating：須 diff 真的成功（status==="succeeded"）才 enable；失敗 / 無結果保持 disabled，
              不做點了無意義的假按鈕。applyDiffOverlay 對 HTTP 錯誤回 {ok,status,detail}，但 coordinator
              不可達時 fetch 會 reject → 此處 catch 後設 err（誠實顯示無法連線），不靜默無反應。 */}
          <Btn prov="p15" disabled={busy || diff?.status !== "succeeded"} caption={t("POST /api/governance/diffs/:id/apply-overlay（後端誠實回 501；可用路徑見下方 inline viewer 疊加）", "POST /api/governance/diffs/:id/apply-overlay (backend honestly returns 501; use the inline viewer overlay below)")} onClick={async () => {
            if (!diffId) return;
            setBusy(true); setErr(null);
            try { setOverlay(await governanceClient.applyDiffOverlay(diffId)); }
            catch (e) { setOverlay(null); setErr(`${t("無法套用 3D Overlay（無法連線 coordinator / 套用失敗）", "Cannot apply 3D Overlay (cannot reach coordinator / apply failed)")}：${String(e)}`); }
            finally { setBusy(false); }
          }}>{t("套用 3D Overlay（後端 p15）", "Apply 3D Overlay (backend p15)")}</Btn>
        </div>
        {overlay && (
          <p className={overlay.ok ? "ec-note" : "ec-warn-note"} style={{ marginTop: 8 }}>
            apply-overlay → {overlay.status}：{overlay.detail}
            {!overlay.ok && overlay.status === 501 && t("（p15：3D 著色走 client highlightPrimsRequest，需 viewer DataChannel；後端不做 server-push）", "(p15: 3D coloring uses client highlightPrimsRequest, requiring a viewer DataChannel; the backend does not server-push)")}
          </p>
        )}
        {impact && (
          <div className="ec-grid" style={{ marginTop: 12 }}>
            <Metric value={impact.possibly_addressed.count} label="issue possibly addressed" />
            <Metric value={impact.still_open.count} label="issue still open" tone="warn" />
            <Metric value={impact.new.count} label="new changes (no issue)" />
          </div>
        )}
        {impact && <p className="ec-note">{impact.note}</p>}
      </Panel>
      {/* A2 F2⑥：diff succeeded 後的 client 端 3D 疊加（inline viewer）。掛 ReviewSessionViewerPane
          （mode="a2-overlay"，複用 A1/Review Room 同一 lease/first-frame/DataChannel/stage 證據鏈），
          「套用疊加」把三組 diff 構件裝進單一 highlightPrimsRequest（Kit 聯集選取）。 */}
      {diffSucceeded && hasDiffItems && (
        <Panel
          title={t("3D 疊加（inline viewer）", "3D overlay (inline viewer)")}
          sub={t("client 端閉環：diff 構件 → element-mapping（for-session）解 usd_prim → viewer 橋單一批次 highlightPrimsRequest", "client-side loop: diff elements → element-mapping (for-session) → single batched highlightPrimsRequest over the viewer bridge")}
          prov="asbuilt"
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <span className="ec-k">review session</span>
            <select
              data-testid="a2-overlay-session-select"
              className="ec-btn"
              value={ovSession}
              onChange={(e) => { setOvSession(e.target.value); setOvAck(null); setOvSend(null); setOvGate({ canSend: false, reason: "" }); }}
            >
              <option value="">{t("— 選擇 active review session —", "— select an active review session —")}</option>
              {ovSessions.map((s) => <option key={s.session_id} value={s.session_id}>{s.session_id}（{s.status}）</option>)}
            </select>
            {ovSessionsErr && <span className="ec-warn-note">{t("無法取得 runtime session 清單", "cannot fetch the runtime session list")}：{ovSessionsErr}</span>}
            {!ovSessionsErr && ovSessions.length === 0 && (
              <span className="ec-note">{t("runtime/status 目前無可 attach 的 active/created session（可先於 #minio 建立 3D session）", "runtime/status has no attachable active/created session (create a 3D session from #minio first)")}</span>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
            <Btn
              primary
              data-testid="a2-overlay-apply"
              disabled={ovBusy || !ovSession || !ovGate.canSend}
              caption={!ovSession
                ? t("先選擇 active review session", "select an active review session first")
                : !ovGate.canSend
                  ? (ovGate.reason || t("等待 viewer pane 掛載（啟動 A2 3D Session）", "waiting for the viewer pane (start the A2 3D session)"))
                  : t("elementMappingForSession 解 usd_prim → 單一批次 highlightPrimsRequest（Kit 聯集選取）", "elementMappingForSession → single batched highlightPrimsRequest (Kit union selection)")}
              onClick={() => { void applyInlineOverlay(); }}
            >
              {ovBusy ? t("套用中…", "Applying…") : t("套用疊加", "Apply overlay")}
            </Btn>
            <span className="ec-note" data-testid="a2-overlay-ack">
              {!ovSend
                ? t("not_sent", "not_sent")
                : ovSend.sent === 0
                  ? (ovSend.error
                    ? `${t("未送出", "not sent")}：${ovSend.error}`
                    : ovSend.fake
                      ? t("未送出：mapping 為 fake（拒用，不冒充真實對映）", "not sent: mapping is fake (rejected; never impersonates a real mapping)")
                      : t("未送出：無可對映構件（全數 unmapped / 缺 GUID）", "not sent: no mappable elements (all unmapped / missing GUID)"))
                  : ovAck
                    ? (ovAck.ok
                      ? `${t("viewer 回報已送 Kit", "viewer acked; sent to Kit")}：sent=${ovAck.sent_count ?? "?"}${typeof ovAck.unmapped_count === "number" ? ` / viewer-unmapped=${ovAck.unmapped_count}` : ""}`
                      : `${t("viewer 回拒", "viewer rejected")}：${ovAck.reason ?? "unknown"}`)
                    : t("pending viewer ack", "pending viewer ack")}
            </span>
          </div>
          {ovSend && ovSend.sent > 0 && (
            <div className="ec-grid" style={{ marginBottom: 8 }}>
              <Metric value={ovSend.groups.added} label={t("新增（藍）已送", "added (blue) sent")} />
              <Metric value={ovSend.groups.removed} label={t("移除（紅）已送", "removed (red) sent")} tone="bad" />
              <Metric value={ovSend.groups.modified} label={t("修改（橘）已送", "modified (orange) sent")} tone="warn" />
            </div>
          )}
          <p className="ec-note" data-testid="a2-overlay-unmapped">
            {ovSend
              ? `${t("unmapped（console 端 mapping 解不出 usd_prim）", "unmapped (console-side mapping)")}：${ovSend.unmappedGuids.length}`
                + (ovSend.noGuidCount > 0 ? `｜${t("diff 列缺 ifc_guid", "diff rows without ifc_guid")}：${ovSend.noGuidCount}` : "")
                + (ovAck && typeof ovAck.unmapped_count === "number" ? `｜${t("viewer 端 unmapped", "viewer-side unmapped")}：${ovAck.unmapped_count}` : "")
              : t("尚未套用；unmapped 會在套用後誠實計數（不虛報）", "not applied yet; unmapped is counted honestly after apply (never inflated)")}
          </p>
          <p className="ec-note">
            {t("圖例：新增=藍 / 移除=紅 / 修改=橘 —— 顏色已按組寫入協定 payload（severityToColor），但 Kit 端 highlight 現況為 USD selection（單色、不讀 per-item color）→ 色彩分組於 Kit 端呈現為 p15；「聯集同顯」（多構件一次選取）是單一批次 request 的真實行為。移除構件通常不存在於目前 session stage 的 mapping → 誠實計入 unmapped。", "Legend: added=blue / removed=red / modified=orange — colors are written per group into the protocol payload (severityToColor), but the current Kit highlight is USD selection (single style, ignores per-item color) → per-group coloring on the Kit side is p15; union display (all elements selected at once) is the real behavior of the single batched request. Removed elements usually do not exist in the current session stage's mapping → honestly counted as unmapped.")}
            {" "}<ProvTag prov="p15" />
          </p>
          {ovSession && (
            <ReviewSessionViewerPane
              key={ovSession}
              ref={ovPaneRef}
              mode="a2-overlay"
              handoff={{
                source: "a2", sessionId: ovSession, ruleRunId: null, ifcGuid: null, usdPrimPath: null,
                ruleCode: null, severity: null, label: null, expectedStageUrl: null,
                mappingInformationStatus: null, mappingIssueCode: null, mappingIssueCount: null,
              }}
              onBatchGateChange={setOvGate}
              onBatchAck={setOvAck}
            />
          )}
        </Panel>
      )}
      <Panel title={t("範圍與誠實標示", "Scope and honest labeling")} prov="asbuilt">
        <Field k="geometry_changed" v={t("opt-in 已實作（include_geometry：ifcopenshell.geom bbox/vertex/volume hash，較重）", "opt-in implemented (include_geometry: ifcopenshell.geom bbox/vertex/volume hash, heavier)")} prov="asbuilt" />
        <Field k={t("3D overlay 顏色（綠/紅/橘/藍）", "3D overlay colors (green/red/orange/blue)")} v={t("apply-overlay 端點誠實回 501；client 端閉環已落地於上方「3D 疊加（inline viewer）」（單一批次 highlightPrimsRequest 聯集選取，需 viewer DataChannel）；per-item 顏色寫入 payload 但 Kit 端 selection 呈現不讀 color（色彩分組 p15），非 server-push", "the apply-overlay endpoint honestly returns 501; the client-side loop lives in the 3D overlay (inline viewer) block above (single batched highlightPrimsRequest union selection over the viewer DataChannel); per-item colors are in the payload but Kit's selection rendering ignores color (per-group coloring is p15); no server-push")} prov="p15" />
        <Field k="Issue impact" v={t("已實作（possibly_addressed 啟發式 / still_open / new，連動 Issue DB）", "implemented (possibly_addressed heuristic / still_open / new, linked to the Issue DB)")} prov="asbuilt" />
      </Panel>
    </>
  );
}
