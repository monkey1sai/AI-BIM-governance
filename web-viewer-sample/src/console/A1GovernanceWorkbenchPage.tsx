// A1 governance workbench and its private helpers.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel } from "./components";
import { uiSteps } from "./a1Machine";
import { useRuleRun } from "./hooks/useRuleRun";
import type { RuleRunSource } from "./hooks/useRuleRun";
import { FileProjectRow, FileVersionRow, governanceClient, IssueRow, LIBRARY_IFC_PREFIX, parseLibraryIfcPath, RuleResultRow, RuleRunHistoryFilters, RuleRunHistoryItem } from "./governanceClient";
import { coordinatorClient, CoordinatorHttpError, isDevRoutesDisabled, IfcReadyListItem, IfcReadyReviewSessionResponse, RuntimeSessionSummary, RuntimeStatus } from "./coordinatorClient";
import { LifecycleStrip } from "./modelData/conversionShared";
import type { ReviewRoomHandoff } from "./ReviewSessionViewerPane";
import { WorkspaceViewerMount } from "./unified/WorkspaceViewerMount";
import { useViewportSlot } from "./unified/viewportSlot";
import { ElementMappingDocument, isFakeMappingDocument, isFakeMappingItem } from "../types/mapping";
import { buildHandoff } from "./handoff";
import { useIncomingHandoff, IncomingHandoffBanner } from "./incomingHandoff";
import { A1IssueViewControls } from "./A1IssueViewControls";
import { A1OutboxStatus } from "./A1OutboxStatus";
import type { ReviewSessionViewerPaneHandle, ReviewSessionViewerPaneBatchGate } from "./ReviewSessionViewerPane";
import { ClosedSessionRecovery } from "./ClosedSessionRecovery";
import { usePolledResource } from "./usePolledResource";
import { ReadyReviewSessions } from "./ReadyReviewSessions";
import { RemediationHistoryPanel } from "./remediation/RemediationHistoryPanel";
import { RemediationConfirmationPanel } from "./remediation/RemediationConfirmationPanel";
import type { HistoryPage } from "./remediation/remediationHistoryClient";
type NativeFilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<Array<{ name: string }>>;
};

const TEST_DATA_PROJECTS_PATH = "/api/dev/test-data-projects";

function isTestDataDevRoutesDisabled(error: unknown): boolean {
  // 契約：coordinator 對 dev routes 關閉一律回 404 + error_code=dev_routes_disabled。
  // 先前比對整串重組訊息，後端把 detail 改一個字就靜默不再命中。
  return isDevRoutesDisabled(error)
    && error instanceof CoordinatorHttpError
    && error.path === TEST_DATA_PROJECTS_PATH;
}

function defaultA1IdsPath(): string {
  return import.meta.env.VITE_A1_DEFAULT_IDS_PATH || "rules/sample-fire-rating.ids";
}

type A1SourceKind = "local_fs" | "minio";
type A1LocalVersionOption = {
  projectId: string;
  modelId: string;
  version: FileVersionRow;
  modelVersionId: string;
};

function flattenA1LocalVersions(projects: FileProjectRow[]): A1LocalVersionOption[] {
  return projects.flatMap((project) =>
    project.models.flatMap((model) =>
      model.versions.map((version) => ({
        projectId: project.project_id,
        modelId: model.model_id,
        version,
        modelVersionId: `${project.project_id}/${model.model_id}/${version.name}`,
      })),
    ),
  );
}

// local_fs 邏輯識別（library://{project_id}/{model_id}/{version.name}）：
// files/tree 對瀏覽器把 version.path 遮蔽成 "[server-path]"（且全部選項同值），
// path 不能當 option value / ifcPath；改用唯一邏輯鍵（LIBRARY_IFC_PREFIX / parseLibraryIfcPath
// 共用於 governanceClient），run 時由 coordinator /api/governance-library/rule-runs
// server-side 解析真路徑（守邊界 B1）。

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileInSameDirectory(currentPath: string, fileName: string): string {
  const cleanName = fileName.replace(/[\\/]/g, "");
  const trimmed = currentPath.trim();
  const slash = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
  if (slash < 0) return cleanName;
  const dir = trimmed.slice(0, slash);
  const sep = trimmed.includes("\\") ? "\\" : "/";
  return `${dir}${sep}${cleanName}`;
}

/**
 * 「有回報才比對」：coordinator 對 nullable 欄位的 null 代表「這次沒回報」，不代表「不相符」。
 * 把未回報當成不相符，會讓依賴該欄位的比對恆假——A1 的 MinIO 選檔就是這樣被鎖死的。
 */
function matchesWhenReported<T>(reported: T | null | undefined, expected: T): boolean {
  return reported === null || reported === undefined || reported === expected;
}

function isElementMappingDocumentLike(value: unknown): value is ElementMappingDocument {
  return Boolean(value && typeof value === "object" && Array.isArray((value as ElementMappingDocument).items));
}
function mappingDiagnosticFromDocument(value: ElementMappingDocument): Pick<RuleResultRow, "mapping_information_status" | "mapping_issue_code" | "mapping_issue_count"> {
  const firstIssue = value.issues?.find((issue) => typeof issue.code === "string");
  const mappingIssueCode = value.summary?.mapping_issue_code ?? firstIssue?.code ?? null;
  const mappingIssueCount = typeof value.summary?.mapping_issue_count === "number"
    ? value.summary.mapping_issue_count
    : value.issues?.length ?? null;
  const mappingInformationStatus = value.summary?.mapping_information_status
    ?? (mappingIssueCode || mappingIssueCount ? "incomplete" : null);
  return {
    mapping_information_status: mappingInformationStatus,
    mapping_issue_code: mappingIssueCode,
    mapping_issue_count: mappingIssueCount,
  };
}
function enrichRuleResultsWithMapping(rows: RuleResultRow[], value: unknown): RuleResultRow[] {
  if (!isElementMappingDocumentLike(value) || isFakeMappingDocument(value)) return rows;
  const primByGuid = new Map<string, string>();
  for (const item of value.items ?? []) {
    if (item.ifc_guid && item.usd_prim_path && !isFakeMappingItem(item)) {
      primByGuid.set(item.ifc_guid, item.usd_prim_path);
    }
  }
  const diagnostic = mappingDiagnosticFromDocument(value);
  return rows.map((row) => {
    if (row.usd_prim_path || !row.ifc_guid) return row;
    const usdPrimPath = primByGuid.get(row.ifc_guid);
    if (usdPrimPath) return { ...row, usd_prim_path: usdPrimPath };
    if (!diagnostic.mapping_information_status && !diagnostic.mapping_issue_code && diagnostic.mapping_issue_count === null) return row;
    return { ...row, ...diagnostic };
  });
}
export function A1GovernanceWorkbenchPage({ active = true }: { active?: boolean } = {}) {
  const workspaceSlot = useViewportSlot();
  const issueViewerRef = useRef<ReviewSessionViewerPaneHandle>(null);
  const [issueViewerGate, setIssueViewerGate] = useState<ReviewSessionViewerPaneBatchGate | null>(null);
  // C3 slice 1：rule-run 狀態機 + pollGen 輪詢抽至共用 hook useRuleRun（seam 的第二個 adapter
  // 是 UnifiedConsole A1Dock）；本頁行為與 DOM 不變。
  const { state, dispatch, runId, run: runRuleRun } = useRuleRun();
  const [idsPath, setIdsPath] = useState(defaultA1IdsPath);
  const [sourceKind, setSourceKind] = useState<A1SourceKind>("local_fs");
  const [fsTree, setFsTree] = useState<FileProjectRow[] | null>(null);
  const [fsErr, setFsErr] = useState<string | null>(null);
  // 值 = 唯一邏輯鍵 {projectId}/{modelId}/{version.name}（＝option.modelVersionId）。
  // 不能存 version.path：proxy 遮蔽後所有選項的 path 同為 "[server-path]"，find 會恆中第一個。
  const [selectedLocalKey, setSelectedLocalKey] = useState<string>("");
  // A1 step①：MinIO source_ifc 物件清單只作來源物件 / handoff。CPU rule-run 需要
  // governance-service 可讀的 server-local path，不能把 object key 當 ifc_source_path 送出。
  const [minioObjects, setMinioObjects] = useState<import("./coordinatorClient").MinioObject[] | null>(null);
  const [minioErr, setMinioErr] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [ifcReadyJobs, setIfcReadyJobs] = useState<IfcReadyListItem[] | null>(null);
  const [ifcReadyErr, setIfcReadyErr] = useState<string | null>(null);
  // 交付動作（建 Issue / 匯出）失敗的誠實 UI 回饋：後端離線時操作員必須看得到失敗
  // （對齊 doRun 的 runError；component-local，不污染 reducer 語意）。下次成功動作清除。
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [a1Issues, setA1Issues] = useState<IssueRow[]>([]);
  const bcfIssues = useMemo(() => a1Issues.filter((issue) => issue.kind === "issue" && Boolean(issue.ifc_guid)), [a1Issues]);
  // 匯出範圍只信任成功 run 的 server-side version；跨版問題仍保留供整改檢視。
  const rawDeliveryVersionId = state.run?.model_version_id ?? "";
  const deliveryVersionId = rawDeliveryVersionId.trim() ? rawDeliveryVersionId : "";
  const exportableBcfIssues = bcfIssues.filter(issue => deliveryVersionId && issue.model_version_id === deliveryVersionId);
  const [remediationSelection, setRemediationSelection] = useState<{
    id: string; runId: string | null; version: string; mode: "history" | "confirm";
  } | null>(null);
  const remediation = remediationSelection?.runId === runId && remediationSelection.version === state.modelVersionId
    ? remediationSelection : null;
  useEffect(() => { setRemediationSelection(null); }, [runId, state.modelVersionId]);
  const updateRemediationIssue = useCallback((issue: HistoryPage["issue"]) => {
    setA1Issues(items => items.map(item => item.id === issue.id ? { ...item, status: issue.status } : item));
  }, []);
  const [existingIssuesBusy, setExistingIssuesBusy] = useState(false);
  const existingIssuesGeneration = useRef(0);
  useEffect(() => {
    setExistingIssuesBusy(false);
    return () => { existingIssuesGeneration.current += 1; };
  }, [runId, state.modelVersionId]);
  async function loadExistingRemediationIssues() {
    const generation = ++existingIssuesGeneration.current;
    setExistingIssuesBusy(true); setActionErr(null); setRemediationSelection(null);
    try {
      const items = await governanceClient.listIssues(undefined, { kind: "issue" });
      if (generation === existingIssuesGeneration.current) setA1Issues(items.filter(item => item.source_type === "rule_result"));
    } catch { if (generation === existingIssuesGeneration.current) setActionErr("既有整改問題載入失敗，請重試。"); }
    finally { if (generation === existingIssuesGeneration.current) setExistingIssuesBusy(false); }
  }
  // F4：fetch 期間 disable 兩鈕（Excel 與 BCF 同等 loading 保護，防重送）。
  const [excelBusy, setExcelBusy] = useState(false);
  const [bcfBusy, setBcfBusy] = useState(false);
  // F2⑩：issue/檢核統計 metadata-only 回拋雲端（POST /api/review-sessions/:sessionId/issue-snapshot）。
  // 202 只代表已入列 coordinator callback outbox（顯 outbox_id）；遞送成敗到 #conv 頁 outbox 摘要觀察，
  // 不在此偽造「已送達雲端」。
  const [issueSnapshotBusy, setIssueSnapshotBusy] = useState(false);
  const [issueSnapshotOutboxId, setIssueSnapshotOutboxId] = useState<string | null>(null);
  const [issueSnapshotErr, setIssueSnapshotErr] = useState<string | null>(null);
  // Review session 是 A1 inline 3D viewer lease / mapping enrichment 的 target；
  // Review Room 仍可作為獨立 fallback route，但不再是 A1 的唯一 3D 入口。
  // A1 v2 的治理 rule-run 直接對已選 IFC 檔案執行；A1 mount 不得自動選第一個 session 或 claim viewer lease。
  const [sessions, setSessions] = useState<RuntimeStatus["sessions"]["items"]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string>("");
  const selectedSessionVersionId = sessions.find(session => session.session_id === selectedSession)?.model_version_id;
  const [runHistory, setRunHistory] = useState<RuleRunHistoryItem[] | null>(null);
  const [runHistoryTotal, setRunHistoryTotal] = useState<number | null>(null);
  const [runHistoryErr, setRunHistoryErr] = useState<string | null>(null);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [runHistoryRefreshTick, setRunHistoryRefreshTick] = useState(0);
  const [reviewOpen, setReviewOpen] = useState<IfcReadyReviewSessionResponse | null>(null);
  const reviewOpenGeneration = useRef(0);
  useLayoutEffect(() => () => { reviewOpenGeneration.current += 1; }, [sourceKind, selectedKey, selectedSession]);
  const [reviewOpenBusy, setReviewOpenBusy] = useState(false);
  const [reviewOpenErr, setReviewOpenErr] = useState<string | null>(null);
  const [conversionRetryBusy, setConversionRetryBusy] = useState(false);
  const [conversionRetryErr, setConversionRetryErr] = useState<string | null>(null);
  const idsFileInputRef = useRef<HTMLInputElement>(null);
  // R8：local_fs 測試 fixtures 專案清單（coordinator config 驅動）。取不到＝空清單＝不標，
  // 誠實降級不阻塞選檔（MinIO 為真實資料監控來源，不標測試資料）。
  const [testDataProjects, setTestDataProjects] = useState<string[]>([]);
  // Task 4C：ENABLE_DEV_ROUTES=false 時 GET /api/dev/test-data-projects 也在 /api/dev/* 404 gate 內
  // （PR #699 D3）。誠實鐵律：404 是「dev routes 已關閉」這個可解釋的已知狀態，不是普通取不到——
  // 顯示 note 讓操作員知道〔測試資料〕徽章暫時不會出現的原因；非 404 的其他失敗維持既有靜默降級
  // （取不到就不標；不擋 A1 流程），不誤報成 dev routes 問題。
  const [testDataDevRoutesDisabled, setTestDataDevRoutesDisabled] = useState(false);
  useEffect(() => {
    let alive = true;
    coordinatorClient.getTestDataProjects()
      .then((r) => { if (alive) { setTestDataProjects(r.projects); setTestDataDevRoutesDisabled(false); } })
      .catch((e) => {
        if (!alive) return;
        if (isTestDataDevRoutesDisabled(e)) setTestDataDevRoutesDisabled(true);
        /* 非 404：取不到就不標；不擋 A1 流程 */
      });
    return () => { alive = false; };
  }, []);
  const ui = uiSteps(state);
  const issueGenRef = useRef(0);
  const issueGuardRef = useRef({ runId: null as string | null, modelVersionId: "" });
  useLayoutEffect(() => {
    issueGuardRef.current = { runId, modelVersionId: state.modelVersionId };
    issueGenRef.current += 1;
    return () => { issueGenRef.current += 1; };
  }, [runId, state.modelVersionId, state.ifcPath, selectedSession]);
  const deliveryGeneration = useRef(0);
  const deliveryBusy = useRef({ excel: false, bcf: false, snapshot: false });
  // 來源 A→B→A 也必須使 A 的舊請求失效；layout cleanup 在新畫面可操作前執行。
  useLayoutEffect(() => {
    deliveryBusy.current = { excel: false, bcf: false, snapshot: false };
    setExcelBusy(false); setBcfBusy(false); setIssueSnapshotBusy(false);
    setActionErr(null);
    setIssueSnapshotOutboxId(null);
    setIssueSnapshotErr(null);
    return () => { deliveryGeneration.current += 1; };
  }, [runId, state.modelVersionId, deliveryVersionId, state.ifcPath, selectedSession, selectedSessionVersionId]);

  const clearReviewOpenState = useCallback(() => {
    reviewOpenGeneration.current += 1;
    setReviewOpen(null);
    setReviewOpenErr(null);
  }, []);
  // 共用 Viewer 只在第一次 publish 播種；此後凡是「明確選定審查」的入口（選取已下載模型、
  // 建立／重用、封存重建、開啟所選審查、進階選單）都必須經 selectReviewSession，不能只改 selectedSession。
  const setViewerSession = workspaceSlot?.setActiveSessionId;
  const selectReviewSession = useCallback((sessionId: string) => {
    if (sessionId !== selectedSession) {
      // 已選 IFC 與觀看目標是分離的；保留 local/ifc-ready 來源，但清除舊 mapping、
      // 結果及交付狀態。session:// 來源不能默默沿用到另一筆審查，必須重新選取。
      // 第一次綁定審查不清除獨立的 CPU 檢核（其版本仍由既有交付 gate 重驗）。
      if (selectedSession) {
        dispatch(state.ifcPath && !state.ifcPath.startsWith("session://")
          ? { type: "PICK_FILE", ifcPath: state.ifcPath, modelVersionId: state.modelVersionId }
          : { type: "RESET" });
        setA1Issues([]);
      }
      setActionErr(null);
      setIssueViewerGate(null);
      clearReviewOpenState();
      setSelectedSession(sessionId);
    }
    // 明確選取只失效舊觀看證據；仍由操作者手動 claim 新 lease。
    setViewerSession?.(sessionId);
  }, [selectedSession, state.ifcPath, state.modelVersionId, dispatch, clearReviewOpenState, setViewerSession]);
  // Task 14（M→A1 接收端重驗）：向已抓取的 minioObjects 重驗 incoming minio_key；查無 → 誠實 not_found。
  // Task14 Important #1：minioObjects===null=尚未載入（見上方 state 註解）。載入中不得壓成 not_found（掛載後
  // 第一個 fetch resolve 前的同步 render 會誤閃假警示），回中性 indeterminate；已載入（[] 或有值）才判 not_found。
  const incoming = useIncomingHandoff("a1", (h) => {
    // Result-history and Session links carry a session. Verify it against runtime,
    // not against the MinIO listing; selecting it still does not claim a lease.
    if (!h.minio_key) {
      if (!h.session) return "not_applicable";
      if (!sessionsLoaded) return "indeterminate";
      return sessions.some(item => item.session_id === h.session && ["created", "active"].includes(item.status));
    }
    if (minioObjects === null) return "indeterminate";
    // reviewer P2（Codex，已核實）：getMinioObjects() 失敗時 catch 分支把 minioObjects 落成 []（非 null），
    // 上面的 null 守門不再成立，未查即誤報 not_found（MinIO 斷線/憑證缺失時對真實 handoff 假警示紅字）。
    // minioErr 非 null＝本來就沒查成功，比照 null 分支同樣退 indeterminate，不假裝已查無。
    if (minioErr !== null) return "indeterminate";
    return minioObjects.some((o) => o.key === h.minio_key);
  });
  const incomingSessionId = incoming.handoff?.session;
  const consumedSessionHandoff = useRef<string | null>(null);
  useEffect(() => {
    if (incoming.status !== "verified" || !incomingSessionId || consumedSessionHandoff.current === incomingSessionId) return;
    const session = sessions.find(item => item.session_id === incomingSessionId && ["created", "active"].includes(item.status));
    if (!session) return; // Runtime is the authority, never the URL alone. No automatic lease claim.
    consumedSessionHandoff.current = incomingSessionId;
    selectReviewSession(session.session_id);
    // Only consume a new handoff once; subsequent manual selection must win.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming.status, incomingSessionId, sessions]);
  // reviewer P2（Codex，已核實）：上面 incoming 只顯示「已重驗」banner，過去從未把 handoff 帶來的 minio_key
  // 真的帶進 selectedKey——operator 看到「已重驗」卻仍要手動從下拉重找同一份檔案。verified 時把
  // minio_key 種進 selectedKey 並切到 MinIO source（不自動 claim session、不自動跑 rule-run；MinIO
  // key 仍不得直接當 ifc_source_path）；用 ref 記住已種過的 key，避免使用者事後手動改選又被這裡打回去。
  const seededHandoffKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const key = incoming.handoff?.minio_key;
    if (incoming.status === "verified" && key && seededHandoffKeyRef.current !== key) {
      seededHandoffKeyRef.current = key;
      if (sourceKind !== "minio" || selectedKey !== key) {
        dispatch({ type: "RESET" });
        setActionErr(null);
        setA1Issues([]);
      }
      setSourceKind("minio");
      setSelectedKey(key);
    }
  }, [incoming.status, incoming.handoff?.minio_key, sourceKind, selectedKey, dispatch]);

  // doRun 輪詢守門（pollGen：unmount / step 離開 running 時遞增）已抽入 useRuleRun。

  // 只列出可手動選取的 active/created session。不得自動選 act[0]；
  // 3D attach/lease 由 A1 inline viewer pane 的明確按鈕啟動。
  const applyRuntimeSessions = useCallback((items: RuntimeSessionSummary[]) => {
    const act = items.filter((s) => s.status === "active" || s.status === "created");
    setSessions(act);
    setSessionsLoaded(true);
    // 關閉後的 session 必須停止當選取值：它的 ready_model_id 會繼續把 MinIO 選檔釘在
    // 一個操作員已經不看的模型上，讓選檔鈕無理由地永遠停在「等待 watcher/轉檔排程」。
    setSelectedSession((current) => {
      if (!current || act.some((s) => s.session_id === current)) return current;
      // 只在 server 確實回報它已非可 attach 狀態時才清；快照裡沒有的 session 可能只是
      // 比快照新（剛建立），此時清掉會誤傷。
      return items.some((s) => s.session_id === current) ? "" : current;
    });
  }, []);
  // 一次性 mount 讀取會讓「關閉 → 重開 session」後的清單永遠停在舊快照（關掉的 session
  // 仍在候選中且仍被選著）。改為輪詢重讀 runtime 真相。
  const sessionsPoll = usePolledResource<RuntimeSessionSummary[]>(
    useCallback(async () => (await coordinatorClient.runtimeStatus()).sessions.items, []),
    { intervalMs: 15000 },
  );
  useEffect(() => {
    if (sessionsPoll.data) applyRuntimeSessions(sessionsPoll.data);
  }, [sessionsPoll.data, applyRuntimeSessions]);
  useEffect(() => {
    // 連不上就空，不假資料（維持原行為：只在真的失敗且尚無資料時清空）。
    if (sessionsPoll.status === "error" && !sessionsPoll.data) setSessions([]);
  }, [sessionsPoll.status, sessionsPoll.data]);

  const loadA1FsTree = useCallback(async () => {
    setFsErr(null);
    setFsTree(null);
    try {
      const tree = await governanceClient.filesTree();
      setFsTree(tree.projects);
    } catch (e) {
      setFsTree([]);
      setFsErr(String(e));
    }
  }, []);

  useEffect(() => {
    void loadA1FsTree();
  }, [loadA1FsTree]);

  // A1（B2）step①：列 MinIO source_ifc 物件供下拉選模型。誠實：失敗顯錯、空就空，不偽造。
  useEffect(() => {
    let alive = true;
    coordinatorClient.getMinioObjects()
      .then((res) => { if (alive) { setMinioObjects(res.objects.filter((o) => o.role === "source_ifc")); setMinioErr(null); } })
      .catch((e) => { if (alive) { setMinioObjects([]); setMinioErr(String(e)); } });
    return () => { alive = false; };
  }, []);

  // A1 MinIO resolution：以 idempotency_key 對 ifc-ready jobs，只有 downloaded + review_session_id
  // 可進入檢核；server-local path 仍由 coordinator for-session resolver 解析，不由 browser 傳入。
  const refreshIfcReadyJobs = useCallback(async (): Promise<IfcReadyListItem[]> => {
    setIfcReadyErr(null);
    try {
      const res = await coordinatorClient.listIfcReady(100);
      setIfcReadyJobs(res.items);
      return res.items;
    } catch (e) {
      setIfcReadyJobs([]);
      setIfcReadyErr(String(e));
      throw e;
    }
  }, []);
  useEffect(() => {
    let alive = true;
    coordinatorClient.listIfcReady(100)
      .then((res) => { if (alive) { setIfcReadyJobs(res.items); setIfcReadyErr(null); } })
      .catch((e) => { if (alive) { setIfcReadyJobs([]); setIfcReadyErr(String(e)); } });
    return () => { alive = false; };
  }, []);
  // 「重新整理模型」時一併更新檢核來源清單，否則新轉檔的模型開啟審查後找不到對應的下載紀錄。
  const reloadRuleCheckSources = useCallback(() => {
    refreshIfcReadyJobs().catch(() => { /* 錯誤已記在 ifcReadyErr，照實顯示 */ });
    coordinatorClient.getMinioObjects()
      .then((res) => { setMinioObjects(res.objects.filter((o) => o.role === "source_ifc")); setMinioErr(null); })
      .catch((e) => { setMinioObjects([]); setMinioErr(String(e)); });
  }, [refreshIfcReadyJobs]);
  // 明確開啟審查後，規則檢核來源跟著同一個模型：找出此審查綁定的已下載 MinIO 轉檔結果，
  // 等同替操作員按「選取已下載模型」。已鎖定的 local_fs 檔案（獨立 CPU 檢核）不覆寫；
  // 找不到下載紀錄或 MinIO 物件時維持原狀，由操作員在規則檢核區自行選取。
  const followReviewModelForRuleCheck = (session: RuntimeSessionSummary) => {
    if (state.ifcPath.startsWith(LIBRARY_IFC_PREFIX) || !session.ready_model_id) return;
    const job = (ifcReadyJobs ?? []).find((item) => item.idempotency_key === session.ready_model_id);
    if (!job || job.download_status !== "downloaded" || job.artifact_health?.source_ifc_exists !== true) return;
    // 與 minioJobForSelection 的精確綁定同一規則：來源 key／etag 有回報就必須相符，
    // 來源物件已重新上傳（etag 變了）時不帶入過期的下載結果。
    const object = (minioObjects ?? []).find((item) =>
      (item.idempotency_key === job.idempotency_key || item.key === job.source_object_key)
      && matchesWhenReported(job.source_object_key, item.key)
      && matchesWhenReported(job.source_ifc_etag, item.etag));
    if (!object) return;
    setSourceKind("minio");
    setSelectedKey(object.key);
    dispatch({
      type: "PICK_FILE",
      ifcPath: job.review_session_id === session.session_id ? `session://${session.session_id}` : `ifc-ready://${job.ifc_ready_job_id}`,
      modelVersionId: job.external_model_version_id || object.version || object.key,
    });
  };

  const selectedMinioObject = sourceKind === "minio"
    ? (minioObjects ?? []).find((o) => o.key === selectedKey) ?? null
    : null;
  const selectedRuntimeSession = sessions.find(item => item.session_id === selectedSession);
  // 同一份來源物件（key + etag 皆相符）的所有轉檔結果。重新轉檔會鑄造獨立 ID，故「這個物件
  // 有沒有下載紀錄」不能只看 watcher 冪等鍵。兩個欄位都必須有回報才算數：null＝未回報，
  // 拿未回報當相符會把別的物件誤認成同一份來源。
  const attemptsForSelectedObject = useCallback((jobs: IfcReadyListItem[]) => (
    selectedMinioObject
      ? jobs.filter(job => job.source_object_key === selectedMinioObject.key
        && job.source_ifc_etag === selectedMinioObject.etag)
      : []
  ), [selectedMinioObject]);

  const minioJobForSelection = useCallback((jobs: IfcReadyListItem[]) => {
    if (!selectedMinioObject) return null;
    const resultId = selectedRuntimeSession?.ready_model_id;
    if (resultId) {
      // Reconverted attempts have independent IDs. Never fall back to another
      // attempt when the selected review has a precise result binding.
      //
      // A null projection means "the coordinator did not report this field", not
      // "mismatch": source_object_key comes from a ledger column that is nullable by
      // design and is null for every landed row. Treating null as a mismatch made the
      // pick impossible for *every* object as soon as any session was selected —
      // including the object the selected session was created from.
      return jobs.find(job => job.idempotency_key === resultId
        && matchesWhenReported(job.source_object_key, selectedMinioObject.key)
        && matchesWhenReported(job.source_ifc_etag, selectedMinioObject.etag)) ?? null;
    }
    // 未選審查：先用 watcher 冪等鍵（既有行為，未重新轉檔的物件走這條）。
    const byWatcherKey = jobs.find(job => job.idempotency_key === selectedMinioObject.idempotency_key);
    if (byWatcherKey) return byWatcherKey;
    // 重新轉檔會鑄造獨立的 idempotency_key（見上方精確綁定註解），與物件自身的 watcher 鍵不同。
    // 只比對 watcher 鍵會讓重新轉檔過的物件永遠對不到——即使它的下載紀錄就在清單裡，
    // 畫面卻叫操作員再去觸發一次轉檔。改以「來源物件 + etag」認回同一份來源的轉檔結果。
    const attempts = attemptsForSelectedObject(jobs);
    // 多次重新轉檔＝多個同樣合法的結果，沒有理由替操作員挑一個。交由「審查紀錄」明確指定。
    return attempts.length === 1 ? attempts[0] : null;
  }, [selectedMinioObject, selectedRuntimeSession?.ready_model_id, attemptsForSelectedObject]);

  const doRun = useCallback(async () => {
    // A1 v2 gating：須先選定 IFC 檔案；review session 只影響後續 3D handoff / mapping enrichment。
    if (state.step === "idle" || !state.ifcPath || (state.ifcPath.startsWith("session://") && !selectedSession)) return;
    setActionErr(null);
    setA1Issues([]);
    const ifcPath = state.ifcPath;
    const modelVersionId = state.modelVersionId;
    const expectedIfcReadyJobId = ifcPath.startsWith("ifc-ready://")
      ? ifcPath.slice("ifc-ready://".length)
      : "";
    // library://（local_fs 檔案庫選檔）→ coordinator /api/governance-library/rule-runs：
    // 瀏覽器送邏輯三段，真 IFC path 由 coordinator server-side 解析（遮蔽後的
    // "[server-path]" 永不回送）。優先於 selectedSession——使用者明確選定「這個檔案」，
    // 檢核就對這個檔案跑；session 只用於後續 mapping enrichment / 3D handoff。
    const libraryRef = ifcPath.startsWith(LIBRARY_IFC_PREFIX) ? parseLibraryIfcPath(ifcPath) : null;
    // preflight（run 前置檢查，於 RUN dispatch 之後、createRuleRun 之前執行）：
    // (a) session:// / ifc-ready:// 來源重驗 watcher job 新鮮度——只有 downloaded 且
    //     source_ifc_exists 才可進檢核；stale → 誠實 RUN_FAIL。
    // (b) library:// 形狀不完整（理論上不會發生；PICK_FILE 只由合法選項組出）→ 誠實 RUN_FAIL。
    const preflight = async (): Promise<string | null> => {
      if (ifcPath.startsWith(LIBRARY_IFC_PREFIX) && !libraryRef) {
        return `invalid library ifc path: ${ifcPath}`;
      }
      if (ifcPath.startsWith("session://") || ifcPath.startsWith("ifc-ready://")) {
        const refreshedJobs = await refreshIfcReadyJobs();
        const refreshedJob = selectedMinioObject?.idempotency_key
          ? minioJobForSelection(refreshedJobs)
          : expectedIfcReadyJobId
            ? refreshedJobs.find((job) => job.ifc_ready_job_id === expectedIfcReadyJobId) ?? null
            : refreshedJobs.find((job) => job.review_session_id === selectedSession) ?? null;
        const refreshedSourceIfcReady =
          refreshedJob?.download_status === "downloaded"
          && (!ifcPath.startsWith("session://") || refreshedJob.review_session_id === selectedSession
            || (selectedRuntimeSession?.ready_model_id === refreshedJob.idempotency_key
              && selectedRuntimeSession?.expected_stage_url === refreshedJob.expected_stage_url))
          && (!expectedIfcReadyJobId || refreshedJob.ifc_ready_job_id === expectedIfcReadyJobId)
          && refreshedJob.artifact_health?.source_ifc_exists === true;
        if (!refreshedSourceIfcReady) {
          const staleReason = refreshedJob?.artifact_health?.stale_reason
            ?? (refreshedJob?.artifact_health?.source_ifc_exists === false ? "source_ifc_exists=false" : "source_ifc_exists=unknown");
          return `source IFC artifact stale before rule-run: ${staleReason}`;
        }
      }
      return null;
    };
    const runRequest = {
      ifc_source_path: ifcPath,
      ids_path: idsPath || undefined,
    } as { ifc_source_path: string; ids_path?: string; model_version_id?: string };
    if (modelVersionId) runRequest.model_version_id = modelVersionId;
    const source: RuleRunSource = expectedIfcReadyJobId
      ? { kind: "for-ifc-ready", ifcReadyJobId: expectedIfcReadyJobId, body: { ids_path: idsPath || undefined } }
      : libraryRef
        ? {
            kind: "for-library",
            request: {
              ...libraryRef,
              ids_path: idsPath || undefined,
              ...(modelVersionId ? { model_version_id: modelVersionId } : {}),
            },
          }
        : selectedSession
          ? { kind: "for-session", sessionId: selectedSession, body: { ids_path: idsPath || undefined } }
          : { kind: "direct", request: runRequest };
    // Mapping enrichment is best-effort（hook 內 try/catch）：失敗時按鈕維持誠實 disabled
    //（無 usd_prim_path 不假裝可高亮）。
    const mappingUrl = sessions.find((s) => s.session_id === selectedSession)?.expected_mapping_url ?? null;
    const enrichFailed = async (failed: RuleResultRow[]): Promise<RuleResultRow[]> => {
      if (!(selectedSession && mappingUrl && failed.some((row) => row.ifc_guid && !row.usd_prim_path))) return failed;
      const mappingDoc = await governanceClient.elementMappingForSession(selectedSession, mappingUrl);
      return enrichRuleResultsWithMapping(failed, mappingDoc);
    };
    const outcome = await runRuleRun(source, { preflight, enrichFailed });
    // MinIO 來源在 run 有終態證據（成功或帶 status 的失敗）時 refresh 檢核歷史；
    // cancelled / preflight_failed / 例外（run=null）不 refresh（與抽 hook 前行為一致）。
    if (sourceKind === "minio" && (outcome.kind === "succeeded" || (outcome.kind === "failed" && outcome.run !== null))) {
      setRunHistoryRefreshTick((value) => value + 1);
    }
  }, [state.step, state.ifcPath, state.modelVersionId, idsPath, selectedSession, sessions, selectedMinioObject, selectedRuntimeSession, minioJobForSelection, sourceKind, refreshIfcReadyJobs, runRuleRun]);

  const setIdsFileNameInCurrentDirectory = useCallback((fileName: string) => {
    setIdsPath((current) => fileInSameDirectory(current || defaultA1IdsPath(), fileName));
  }, []);

  const openIdsFilePicker = useCallback(async () => {
    const picker = (window as NativeFilePickerWindow).showOpenFilePicker;
    if (picker) {
      try {
        const [handle] = await picker({
          multiple: false,
          types: [{ description: "buildingSMART IDS", accept: { "application/xml": [".ids"], "text/xml": [".ids"] } }],
        });
        if (handle?.name) setIdsFileNameInCurrentDirectory(handle.name);
        return;
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
      }
    }
    idsFileInputRef.current?.click();
  }, [setIdsFileNameInCurrentDirectory]);

  const makeIssues = useCallback(async () => {
    if (!runId) return;
    const guardedRunId = runId;
    const guardedModelVersionId = state.modelVersionId;
    const guardedIssueGen = issueGenRef.current;
    const isCurrentIssueRequest = () =>
      issueGenRef.current === guardedIssueGen &&
      issueGuardRef.current.runId === guardedRunId &&
      issueGuardRef.current.modelVersionId === guardedModelVersionId;
    setActionErr(null); // 重試前清掉上次錯誤
    try {
      const { created, issue_ids } = await governanceClient.issuesFromRuleRun(runId);
      try {
        if (issue_ids.length > 0) {
          const rows = await Promise.all(issue_ids.map((id) => governanceClient.getIssue(id)));
          if (!isCurrentIssueRequest()) return;
          setA1Issues(rows);
        } else {
          if (guardedModelVersionId) {
            const existingRows = await governanceClient.listIssues(undefined, {
              model_version_id: guardedModelVersionId,
              kind: "issue",
            });
            if (!isCurrentIssueRequest()) return;
            const ruleIssues = existingRows.filter((issue) => issue.source_type === "rule_result" && issue.ifc_guid);
            if (ruleIssues.length > 0) {
              setA1Issues(ruleIssues);
            } else {
              setActionErr(t("未找到此模型版本既有 rule-run Issue；請重新建立或檢查後端 issue store。", "No existing rule-run issues were found for this model version; recreate them or check the backend issue store."));
              return;
            }
          } else {
            if (!isCurrentIssueRequest()) return;
            setActionErr(t("後端未回傳 issue_ids，且本次 rule-run 未綁定 model_version_id，無法安全重載既有 Issue。", "The backend returned no issue_ids and this rule-run has no model_version_id, so existing Issues cannot be safely reloaded."));
            return;
          }
        }
      } catch (e) {
        if (!isCurrentIssueRequest()) return;
        setActionErr(`${t("載入 Issue 詳情失敗：", "Failed to load Issue details: ")}${String(e)}`);
        return;
      }
      if (!isCurrentIssueRequest()) return;
      dispatch({ type: "CREATE_ISSUES_OK", issueCount: created });
    } catch (e) {
      // 後端離線：誠實不前進（不偽造 issued），但顯示失敗讓操作員知道（誠實鐵律）。
      if (!isCurrentIssueRequest()) return;
      setActionErr(`${t("建 Issue 失敗：", "Failed to create Issue: ")}${String(e)}`);
    }
  }, [runId, state.modelVersionId, dispatch]);

  const doExport = useCallback(async () => {
    if (!runId || deliveryBusy.current.excel) return;
    const generation = deliveryGeneration.current;
    deliveryBusy.current.excel = true;
    setActionErr(null); // 重試前清掉上次錯誤
    setExcelBusy(true);
    try {
      const res = await fetch(governanceClient.exportUrl(runId));
      if (generation !== deliveryGeneration.current) return;
      if (!res.ok) { setActionErr(`${t("匯出失敗：HTTP ", "Export failed: HTTP ")}${res.status}`); return; }
      const blob = await res.blob();
      if (generation !== deliveryGeneration.current) return;
      const url = URL.createObjectURL(blob);
      // 錨點須掛載於 document 才觸發 .click()：Firefox（Gecko）與部分 Edge 對 detached <a> 下載不可靠，
      // 會靜默失敗（EXPORT_OK 永不 dispatch、UI 卡 scored 無回饋，違誠實鐵律）。appendChild→click→removeChild
      // 為跨瀏覽器最安全慣例。
      const a = document.createElement("a"); a.href = url; a.download = `rule-run-${runId}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      dispatch({ type: "EXPORT_OK" });
    } catch (e) {
      if (generation !== deliveryGeneration.current) return;
      setActionErr(`${t("匯出失敗：", "Export failed: ")}${String(e)}`); // 誠實顯示失敗，不靜默
    } finally {
      if (generation === deliveryGeneration.current) { deliveryBusy.current.excel = false; setExcelBusy(false); }
    }
  }, [runId, dispatch]);

  const transitionA1Issue = useCallback(async (issue: IssueRow) => {
    const next = issue.status === "open" ? "in_progress" : issue.status === "in_progress" && issue.source_type !== "rule_result" ? "resolved" : null;
    if (!next) return;
    const generation = deliveryGeneration.current;
    setActionErr(null);
    try {
      const updated = await governanceClient.transitionIssue(issue.id, next, "A1 BCF review panel transition");
      if (generation !== deliveryGeneration.current) return;
      setA1Issues((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (e) {
      if (generation !== deliveryGeneration.current) return;
      setActionErr(`${t("Issue 狀態更新失敗：", "Issue transition failed: ")}${String(e)}`);
    }
  }, []);

  // 來源可為檔案庫或 IFC-ready；回拋前必須明確選擇同版本 session。
  // UI 的核對不授予權限，coordinator 仍在 enqueue 前重驗 canonical version。
  const issueSnapshotSessionId = deliveryVersionId && selectedSessionVersionId === deliveryVersionId ? selectedSession : "";
  const issueSnapshotRunSucceeded = Boolean(runId) && ["scored", "issued", "delivered"].includes(state.step);
  const canIssueSnapshot = issueSnapshotRunSucceeded && Boolean(issueSnapshotSessionId);
  const issueSnapshotReason = !issueSnapshotRunSucceeded
    ? t("需先成功完成 rule-run 檢核", "Run a successful rule-run first")
    : selectedSession
      ? t("檢核與所選 Session 的模型版本必須相同", "The run and selected session must share a model version")
      : t("需 review session 脈絡（F2⑩ 綁 session）", "Requires review session context (F2⑩ binds the session)");
  const doIssueSnapshot = useCallback(async () => {
    if (!canIssueSnapshot || !runId || !issueSnapshotSessionId || deliveryBusy.current.snapshot) return;
    const generation = deliveryGeneration.current;
    deliveryBusy.current.snapshot = true;
    setIssueSnapshotBusy(true);
    setIssueSnapshotErr(null);
    setIssueSnapshotOutboxId(null);
    try {
      const res = await coordinatorClient.postIssueSnapshot(issueSnapshotSessionId, {
        rule_run_id: runId,
        ...(deliveryVersionId ? { model_version_id: deliveryVersionId } : {}),
      });
      if (generation !== deliveryGeneration.current) return;
      setIssueSnapshotOutboxId(res.outbox_id);
    } catch (e) {
      if (generation !== deliveryGeneration.current) return;
      // 502＝coordinator 查 governance 統計失敗、未入列（後端誠實不偽造統計）；其餘照實顯示。
      const message = String(e);
      setIssueSnapshotErr(message.includes("governance_unreachable")
        ? `${t("governance 不可達，摘要未入列：", "governance unreachable; the snapshot was not enqueued: ")}${message}`
        : `${t("回拋失敗：", "Snapshot failed: ")}${message}`);
    } finally {
      if (generation === deliveryGeneration.current) { deliveryBusy.current.snapshot = false; setIssueSnapshotBusy(false); }
    }
  }, [runId, issueSnapshotSessionId, deliveryVersionId, canIssueSnapshot]);

  // A1（B2）下拉項 label：專案·種類·版本·檔名（缺值以「?」誠實標示，不臆造）。
  const minioLabel = (o: import("./coordinatorClient").MinioObject) =>
    `${o.project_display_name ?? o.project_id ?? "?"} · ${o.category ?? "?"} · ${o.version ?? "?"} · ${o.key.split("/").pop() ?? o.key}`;

  const localOptions = flattenA1LocalVersions(fsTree ?? []);
  // 以唯一邏輯鍵（modelVersionId）比對——version.path 被 proxy 遮蔽後全部同值，不能當鍵。
  const selectedLocalOption = localOptions.find((option) => option.modelVersionId === selectedLocalKey) ?? null;
  const canPickLocal = sourceKind === "local_fs" && Boolean(selectedLocalOption);
  const selectedMinioJob = selectedMinioObject && ifcReadyJobs
    ? minioJobForSelection(ifcReadyJobs)
    : null;
  const selectedMinioSessionId = selectedMinioJob && selectedRuntimeSession?.ready_model_id === selectedMinioJob.idempotency_key
    ? selectedSession : selectedMinioJob?.review_session_id ?? "";
  const selectedMinioDownloaded = selectedMinioJob?.download_status === "downloaded";
  const selectedMinioSourceIfcReady = selectedMinioJob?.artifact_health?.source_ifc_exists === true;
  const selectedMinioJobId = selectedMinioJob?.ifc_ready_job_id ?? "";
  const selectedMinioConversionReady = Boolean(
    selectedMinioJob?.conversion_job_id
      && ["ready", "succeeded", "succeeded_with_warnings"].includes(selectedMinioJob.conversion_status ?? "")
      && selectedMinioJob.expected_stage_url
      && selectedMinioJob.expected_mapping_url,
  );
  const selectedMinioConversionRetryable = Boolean(
    selectedMinioJobId
      && selectedMinioDownloaded
      && selectedMinioSourceIfcReady
      && ["dispatch_failed", "dropped_on_restart"].includes(selectedMinioJob?.status ?? ""),
  );
  const selectedMinioReviewSessionReason = !selectedMinioJobId
    ? t("需先選取 MinIO downloaded IFC job；local_fs 不自動建 viewer session", "Select a MinIO downloaded IFC job first; local_fs does not auto-create a viewer session")
    : selectedMinioSessionId || selectedMinioConversionReady
      ? ""
      : `${t("IFC→USD conversion 尚未 ready，不能建立 A1 3D session：", "IFC->USD conversion is not ready; cannot create an A1 3D session: ")}${selectedMinioJob?.conversion_status ?? "not_dispatched"}`;
  const selectedMinioSourceIfcStaleReason =
    selectedMinioJob?.artifact_health?.stale_reason
    ?? (selectedMinioJob?.artifact_health?.source_ifc_exists === false ? "source_ifc_exists=false" : "source_ifc_exists=unknown");
  const canPickMinioDownloaded = sourceKind === "minio" && Boolean(
    selectedMinioObject && selectedMinioDownloaded && selectedMinioJobId && selectedMinioSourceIfcReady,
  );
  // 精確綁定分支把 job 排除掉時，job 其實就在清單裡——擋下它的是「所選 review session
  // 綁著另一個轉檔結果」。沿用「尚未找到 watcher 下載紀錄」會叫操作員去觸發根本不需要的
  // 轉檔（181 實站就是這樣被誤導的），故在此分辨兩種情形並據實說明。
  // 未選審查、且同一份來源有多次轉檔結果時，A1 不替操作員挑一個。此時「沒有下載紀錄」是假話，
  // 真相是「有好幾筆、需要你指定」——據實說明並指向可執行的下一步。
  const ambiguousAttempts = !selectedMinioJob && !selectedRuntimeSession?.ready_model_id && ifcReadyJobs
    ? attemptsForSelectedObject(ifcReadyJobs)
    : [];
  const ambiguousAttemptsReason = ambiguousAttempts.length > 1
    ? `${t("此物件有 ", "This object has ")}${ambiguousAttempts.length}${t(" 次轉檔結果（重新轉檔會各自產生獨立 ID）。A1 不替你挑一次，請在「審查紀錄」選擇要用哪一次的審查。", " conversion results (each reconversion mints its own ID). A1 will not pick one for you; select the review for the attempt you want in the review-record list.")}`
    : "";
  const pinnedReadyModelId = selectedRuntimeSession?.ready_model_id ?? "";
  const pinBlockedJobs = !selectedMinioJob && pinnedReadyModelId && selectedMinioObject && ifcReadyJobs
    ? {
        forSelectedObject: ifcReadyJobs.find((job) => job.idempotency_key === selectedMinioObject.idempotency_key) ?? null,
        forPinnedResult: ifcReadyJobs.find((job) => job.idempotency_key === pinnedReadyModelId) ?? null,
      }
    : null;
  // 被釘住的結果究竟是「此物件的另一次轉檔」還是「另一個模型」，必須看 source_object_key 才能斷定。
  // 先前只要 pinned job 存在就一律說成「此物件的另一個版本」，在跨模型時是錯的（實站上把
  // 東勢區圖書館的結果說成 ifc-test 的別版），還會叫使用者去做不需要的重新轉檔。
  // null＝未回報，此時不對同/異物件下任何結論。
  const pinnedSourceKey = pinBlockedJobs?.forPinnedResult?.source_object_key ?? null;
  const pinnedObjectRelation: "same" | "different" | "unknown" = !pinBlockedJobs?.forPinnedResult
    ? "unknown"
    : pinnedSourceKey === null
      ? "unknown"
      : pinnedSourceKey === selectedMinioObject?.key ? "same" : "different";
  // 此物件自身有沒有 watcher 下載紀錄——兩種情形的後續動作完全不同，必須分開講。
  const selectedObjectHasJob = pinBlockedJobs?.forSelectedObject ?? null;
  const selectedObjectFact = !pinBlockedJobs
    ? ""
    : selectedObjectHasJob
      ? `${t("此物件本身有 watcher 下載紀錄（", "This object does have a watcher download record (")}${selectedObjectHasJob.ifc_ready_job_id}${t("）。", "). ")}`
      : t("此物件目前沒有 watcher 下載紀錄。", "This object currently has no watcher download record. ");
  const clearHint = t("請先把「審查紀錄」清回「—」；若要沿用既有審查，請改選對應此模型的那一筆。",
    "Clear the review record back to \"—\" first; to keep an existing review, select the one bound to this model.");
  const pinBlockReason = !pinBlockedJobs
    ? ""
    : pinnedObjectRelation === "same"
      ? `${t("所選審查紀錄綁定的是此物件的另一次轉檔結果（", "The selected review is bound to another conversion attempt of this object (")}${pinnedReadyModelId}${t("），來源 etag 與目前物件不符。請改選對應該次結果的審查紀錄，或把「審查紀錄」清回「—」。", "); its source etag does not match the current object. Select the review bound to that attempt, or clear the review record back to \"—\".")}`
      : pinnedObjectRelation === "different"
        ? `${t("所選審查紀錄綁定的是另一個模型的轉檔結果（", "The selected review is bound to a conversion result for a different model (")}${pinnedSourceKey}${t("）。", "). ")}${selectedObjectFact}${clearHint}`
        : pinBlockedJobs.forPinnedResult || selectedObjectHasJob
          // 來源 key 未回報：只陳述「被另一個結果釘住」這個可驗證的事實，不猜是否同物件。
          ? `${t("所選審查紀錄綁定的是另一個轉檔結果（", "The selected review is bound to another conversion result (")}${pinnedReadyModelId}${t("）。", "). ")}${selectedObjectFact}${clearHint}`
          : "";
  const selectedMinioResolutionNote = !selectedKey
    ? t("請先選擇 MinIO source_ifc 物件。", "Select a MinIO source_ifc object first.")
    : ifcReadyErr
      ? `${t("ifc-ready job 清單不可用：", "ifc-ready job list unavailable: ")}${ifcReadyErr}`
      : ifcReadyJobs === null
        ? t("正在載入 watcher downloaded ifc-ready jobs…", "Loading watcher downloaded ifc-ready jobs...")
        : !selectedMinioJob
          ? pinBlockReason
            || ambiguousAttemptsReason
            || `${t("尚未找到 watcher 下載紀錄；A1 不會直接檢核 MinIO key。請用 MinIO/IFC->USD 排程頁觸發 POST /api/conversion/trigger。idempotency_key=", "No watcher download record found; A1 will not validate a MinIO key directly. Use the MinIO/IFC->USD schedule page to trigger POST /api/conversion/trigger. idempotency_key=")}${selectedMinioObject?.idempotency_key ?? "unknown"}`
          : !selectedMinioDownloaded
            ? `${t("watcher job 尚未下載完成，A1 等待 downloaded 狀態。download_status=", "Watcher job is not downloaded yet; A1 waits for downloaded status. download_status=")}${selectedMinioJob.download_status ?? "unknown"}${selectedMinioJob.download_failure ? ` (${selectedMinioJob.download_failure})` : ""}`
            : !selectedMinioSourceIfcReady
              ? `${t("watcher job 已下載，但 source IFC artifact stale；A1 不啟動 rule-run：", "Watcher job is downloaded, but the source IFC artifact is stale; A1 will not start a rule-run: ")}${selectedMinioSourceIfcStaleReason}`
              : selectedMinioSessionId && selectedMinioSessionId === selectedMinioJob.review_session_id
                ? `${t("已對到 watcher downloaded job 與 review session；rule-run 將走 coordinator for-session proxy：", "Matched watcher downloaded job and review session; rule-run will use coordinator for-session proxy: ")}${selectedMinioJob.ifc_ready_job_id} / ${selectedMinioSessionId}`
                : `${t("已對到 watcher downloaded job；coordinator ifc-ready proxy（POST /api/governance/rule-runs/for-ifc-ready）只排入 A1 governance rule-run queue：", "Matched watcher downloaded job; coordinator ifc-ready proxy (POST /api/governance/rule-runs/for-ifc-ready) queues only the A1 governance rule-run: ")}${selectedMinioJob.ifc_ready_job_id}`;
  const selectedMinioPickLabel = canPickMinioDownloaded
    ? t("選取已下載模型", "Select Downloaded Model")
    : !selectedKey
      ? t("等待選擇 MinIO 模型", "Waiting for MinIO model")
      : ifcReadyJobs === null
        ? t("載入 downloaded jobs", "Loading downloaded jobs")
        : !selectedMinioJob
          ? pinBlockReason
            ? t("審查紀錄綁定其他結果", "Review pinned to another result")
            : t("等待 watcher/轉檔排程", "Waiting for watcher/conversion schedule")
          : !selectedMinioDownloaded
            ? t("等待 downloaded session", "Waiting for downloaded session")
            : !selectedMinioSourceIfcReady
              ? t("source IFC artifact stale", "source IFC artifact stale")
              : t("選取已下載模型", "Select Downloaded Model");
  const selectedSessionSummary = sessions.find((s) => s.session_id === selectedSession) ?? null;
  const canRunA1 = state.step !== "idle"
    && Boolean(state.ifcPath)
    && !(state.ifcPath.startsWith("session://") && !selectedSession)
    && !(state.ifcPath.startsWith("session://") && !selectedMinioSourceIfcReady)
    && !(state.ifcPath.startsWith("ifc-ready://") && !selectedMinioSourceIfcReady)
    && !(state.step === "running" && !state.runError);
  const ensureReviewSessionForSelectedIfcReady = useCallback(async (): Promise<IfcReadyReviewSessionResponse | null> => {
    if (!selectedMinioJobId || !selectedMinioJob) {
      setReviewOpenErr(t("沒有可建立 A1 3D session 的 ifc-ready job。", "No IFC-ready job is available for an A1 3D session."));
      return null;
    }
    if (!selectedMinioSessionId && !selectedMinioConversionReady) {
      setReviewOpenErr(selectedMinioReviewSessionReason || t("IFC→USD conversion 尚未 ready。", "IFC->USD conversion is not ready."));
      return null;
    }
    setReviewOpenBusy(true);
    setReviewOpenErr(null);
    const generation = reviewOpenGeneration.current;
    try {
      const res = await coordinatorClient.createReviewSessionForIfcReady(selectedMinioJobId);
      // 來源／審查已改選時，舊建立請求不能重新發布 Stage 或覆寫觀看目標。
      if (generation !== reviewOpenGeneration.current) return null;
      // 先切換目標（會清掉舊 reviewOpen），再記錄本次回覆的預期 Stage。
      selectReviewSession(res.review_session_id);
      setReviewOpen(res);
      setSessions((items) => {
        const summary: RuntimeSessionSummary = {
          session_id: res.review_session_id,
          status: res.session_status,
          project_id: selectedMinioJob.project_id,
          model_version_id: selectedMinioJob.external_model_version_id,
          participant_count: 0,
          expected_stage_url: res.expected_stage_url,
          expected_mapping_url: res.expected_mapping_url,
          conversion_job_id: res.conversion_job_id,
          conversion_status: res.conversion_status,
          kit_instance_ids: [],
          created_at: "",
          updated_at: "",
          first_frame_at: null,
          artifact_health: res.artifact_health ?? null,
          ready_model_id: null,
          participants: [],
          stage_open_state: "not_requested",
          stage_open_evidence: {
            state: "not_requested",
            source: "coordinator",
            detail: "synthesized locally after session open; no runtime evidence yet",
            expected_stage_url: res.expected_stage_url,
            loaded_stage_url: null,
            datachannel_ready: false,
            first_frame_at: null,
          },
          primary_viewer_lease_id: null,
          primary_viewer_user_id: null,
          viewer_leases: [],
          // 本地合成 placeholder（下次 runtime/status 輪詢會以 coordinator 真值取代）；ledger 欄位誠實 null。
          // 此端點（POST /api/external/ifc-ready/:jobId/review-session）只會回既有 session 或由終端觀察者以
          // created_by="coordinator-auto-conversion-ready" 自動建立，故 kind 取 auto_conversion_ready（接替 closed
          // session 時 coordinator 真值會是 recreated，由下一輪輪詢修正）。
          origin: {
            kind: "auto_conversion_ready", created_by: "coordinator-auto-conversion-ready", intake_source: null,
            project_display_name: null, category: null, bucket: null, source_object_key: null, source_ifc_filename: null,
            recreated_from_session_id: null, ledger_detected_at: null,
          },
        };
        return items.some((item) => item.session_id === res.review_session_id)
          // 既有 item 已有 coordinator 真 origin，不得被本地 placeholder 覆蓋。
          ? items.map((item) => item.session_id === res.review_session_id ? { ...item, ...summary, origin: item.origin } : item)
          : [summary, ...items];
      });
      setIfcReadyJobs((items) => items
        ? items.map((job) => job.ifc_ready_job_id === selectedMinioJobId
          ? {
              ...job,
              review_session_id: res.review_session_id,
              viewer_url: res.viewer_url,
              expected_stage_url: res.expected_stage_url,
              expected_mapping_url: res.expected_mapping_url,
              conversion_status: res.conversion_status,
              artifact_health: res.artifact_health ?? job.artifact_health,
            }
          : job)
        : items);
      return res;
    } catch (e) {
      if (generation === reviewOpenGeneration.current) setReviewOpenErr(String(e));
      return null;
    } finally {
      setReviewOpenBusy(false);
    }
  }, [selectedMinioConversionReady, selectedMinioJob, selectedMinioJobId, selectedMinioReviewSessionReason, selectedMinioSessionId, selectReviewSession]);

  const retrySelectedMinioConversion = useCallback(async () => {
    if (!selectedMinioJobId) return;
    setConversionRetryBusy(true);
    setConversionRetryErr(null);
    setReviewOpenErr(null);
    try {
      await coordinatorClient.conversionRetry(selectedMinioJobId, "A1 inline 3D session recovery");
      try {
        await refreshIfcReadyJobs();
      } catch (e) {
        setReviewOpenErr(`${t("重派成功，但重新載入 ifc-ready job 失敗：", "Retry succeeded, but refreshing the IFC-ready job failed: ")}${String(e)}`);
      }
    } catch (e) {
      setConversionRetryErr(String(e));
    } finally {
      setConversionRetryBusy(false);
    }
  }, [refreshIfcReadyJobs, selectedMinioJobId]);

  const selectedReviewExpectedStageUrl = (reviewOpen?.review_session_id === selectedSession ? reviewOpen.expected_stage_url : null)
    ?? selectedSessionSummary?.expected_stage_url ?? null;
  const a1InlineHandoff = useMemo<ReviewRoomHandoff | null>(() => {
    if (!selectedSession) return null;
    const row = state.failed.find((item) => item.ifc_guid) ?? state.failed[0] ?? null;
    return {
      source: "a1",
      sessionId: selectedSession,
      ruleRunId: runId,
      ifcGuid: row?.ifc_guid ?? null,
      usdPrimPath: row?.usd_prim_path ?? null,
      ruleCode: row?.rule_code ?? null,
      severity: row?.severity ?? null,
      label: row?.message ?? row?.ifc_guid ?? null,
      expectedStageUrl: selectedReviewExpectedStageUrl,
      mappingInformationStatus: row && !row.usd_prim_path
        ? row.mapping_information_status ?? "incomplete"
        : row?.mapping_information_status ?? null,
      mappingIssueCode: row?.mapping_issue_code ?? null,
      mappingIssueCount: typeof row?.mapping_issue_count === "number" ? String(row.mapping_issue_count) : null,
    };
  }, [runId, selectedReviewExpectedStageUrl, selectedSession, state.failed]);

  const selectedMinioHistoryFilters = useMemo<RuleRunHistoryFilters | null>(() => {
    if (sourceKind !== "minio" || !selectedMinioObject) return null;
    const filters: RuleRunHistoryFilters = { limit: 5 };
    const put = (
      key: "project_id" | "model_category" | "model_version_id" | "ifc_ready_job_id" | "idempotency_key" | "review_session_id",
      value: string | null | undefined,
    ) => {
      if (value && value.trim().length > 0) {
        filters[key] = value;
      }
    };
    put("project_id", selectedMinioJob?.project_id ?? selectedMinioObject.project_id);
    put("model_category", selectedMinioJob?.category ?? selectedMinioObject.category);
    put("model_version_id", selectedMinioJob?.external_model_version_id ?? selectedMinioObject.version);
    put("ifc_ready_job_id", selectedMinioJob?.ifc_ready_job_id);
    put("idempotency_key", selectedMinioJob?.idempotency_key ?? selectedMinioObject.idempotency_key);
    return filters;
  }, [sourceKind, selectedMinioObject, selectedMinioJob]);

  useEffect(() => {
    if (!selectedMinioHistoryFilters) {
      setRunHistory(null);
      setRunHistoryTotal(null);
      setRunHistoryErr(null);
      setRunHistoryLoading(false);
      return;
    }
    let alive = true;
    setRunHistoryLoading(true);
    setRunHistoryErr(null);
    governanceClient.listRuleRuns(selectedMinioHistoryFilters)
      .then((res) => {
        if (!alive) return;
        setRunHistory(res.items);
        setRunHistoryTotal(res.total);
      })
      .catch((e) => {
        if (!alive) return;
        setRunHistory([]);
        setRunHistoryTotal(null);
        setRunHistoryErr(String(e));
      })
      .finally(() => {
        if (alive) setRunHistoryLoading(false);
      });
    return () => { alive = false; };
  }, [selectedMinioHistoryFilters, runHistoryRefreshTick]);

  return (
    <>
      <h1>{t("A1 · 治理與模型檢核", "A1 · Governance & Model Validation")}</h1>
      <IncomingHandoffBanner testId="a1-incoming-handoff" handoff={incoming.handoff} status={incoming.status} />
      <details className="op-inline-help"><summary>{t("如何操作？", "How to use")}</summary><p className="ec-lead">{t("先在「選擇模型與審查」開啟審查並啟動 3D；開啟後，下方規則檢核會自動帶入同一個模型。只想看模型時不必執行規則檢核。", "Open a review in Choose model and review and start 3D; the rule check below then follows the same model. To view a model only, you do not need to run a check.")}</p></details>

      <Panel title={t("選擇模型與審查", "Choose model and review")} sub={t("選模型 → 開啟審查（預設 MinIO 自動審查）→ 左側「啟動 A1 3D Session」。高亮與剖切需等畫面及模型核對完成。", "Choose a model → open its review (the MinIO auto review by default) → Start A1 3D Session on the left. Highlight and section tools require frames and a verified model.")} prov="asbuilt">
        <ReadyReviewSessions sessions={sessions} currentSessionId={selectedSession} onSessionsRefreshed={setSessions}
          onModelsReloaded={reloadRuleCheckSources} onSelected={(session) => {
            setSessions(current => [...current.filter(item => item.session_id !== session.session_id), session]);
            // 只有明確開啟且經 coordinator 確認後才切換共用 Viewer；單純瀏覽選單／Dock 重掛不切換。
            // 此處只更新目標並失效舊證據；lease 仍須使用者按「啟動 3D」。
            selectReviewSession(session.session_id);
            followReviewModelForRuleCheck(session);
          }} />
        {sessions.length === 0 && (
          <div data-testid="a1-no-session">
            <p className="ec-note">{t("無 active session。若已有 downloaded IFC-ready job，A1 仍可先跑 CPU rule-run；3D 高亮需先讓 IFC→USD conversion ready，再在本頁建立 / 啟動 3D session。", "No active session. If a downloaded IFC-ready job exists, A1 can still run the CPU rule-run; 3D highlight requires IFC->USD conversion ready, then the 3D session is created and started on this page.")}</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Btn data-testid="a1-trigger-convert" disabled
                caption={t("A1 v2 不觸發 conversion；請到 IFC→USD 轉檔排程頁操作", "A1 v2 does not trigger conversion; use the IFC→USD schedule page")}>
                {t("A1 不排入轉檔", "A1 does not queue conversion")}
              </Btn>
              <a className="ec-s" data-testid="a1-conv-link" href={buildHandoff("minio", { source: "a1", minio_key: sourceKind === "minio" ? selectedKey || undefined : undefined })}>{t("查看 MinIO 來源 →", "View MinIO source →")}</a>
            </div>
            <div style={{ marginTop: 12 }}>
              <ClosedSessionRecovery compact onRecreated={(result, source) => {
                const summary: RuntimeSessionSummary = {
                  session_id: result.session_id,
                  status: result.status,
                  project_id: source.project_id,
                  model_version_id: source.model_version_id,
                  participant_count: 0,
                  expected_stage_url: null,
                  expected_mapping_url: null,
                  conversion_job_id: null,
                  conversion_status: null,
                  kit_instance_ids: [],
                  created_at: "",
                  updated_at: "",
                  first_frame_at: null,
                  artifact_health: null,
                  ready_model_id: null,
                  participants: [],
                  stage_open_state: "not_requested",
                  stage_open_evidence: {
                    state: "not_requested",
                    source: "coordinator",
                    detail: "synthesized locally after session open; no runtime evidence yet",
                    expected_stage_url: null,
                    loaded_stage_url: null,
                    datachannel_ready: false,
                    first_frame_at: null,
                  },
                  primary_viewer_lease_id: null,
                  primary_viewer_user_id: null,
                  viewer_leases: [],
                  // 本地合成 placeholder（下次 runtime/status 輪詢會以 coordinator 真值取代）；重建來源為已知事實。
                  origin: {
                    kind: "recreated", created_by: "console-local-placeholder", intake_source: null,
                    project_display_name: null, category: null, bucket: null, source_object_key: null, source_ifc_filename: null,
                    recreated_from_session_id: source.session_id, ledger_detected_at: null,
                  },
                };
                setSessions([summary]);
                selectReviewSession(result.session_id);
              }} />
            </div>
          </div>
        )}
        {/* 一般操作只需要上方「開啟所選審查」；以下是舊入口與修復工具，收進進階以免和主流程並列。 */}
        <details className="op-help" data-testid="a1-review-advanced">
          <summary>{t("進階：審查紀錄、MinIO 自動審查與重派轉檔", "Advanced: review records, MinIO auto review, and conversion retry")}</summary>
          {sessions.length > 0 && <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <label htmlFor="a1-manual-session">{t("審查紀錄", "Review record")}</label>
              {/* 切換觀看目標後重跑檢核，不把舊 session 的 mapping/failed rows 送到新 Viewer。 */}
              <select id="a1-manual-session" data-testid="a1-session-select" value={selectedSession} onChange={(e) => {
                const nextSession = e.target.value;
                if (nextSession === selectedSession) return;
                selectReviewSession(nextSession);
              }}>
                <option value="">{t("— 手動選擇 review session —", "— manually select a review session —")}</option>
                {sessions.map((s) => <option key={s.session_id} value={s.session_id}>{s.project_id} · {s.model_version_id} · {s.session_id}（{s.status}）</option>)}
              </select>
            </div>
            <div className="ec-grid" style={{ marginBottom: 8 }}>
              <Field k="selected session" v={selectedSession || t("not_selected（未綁定 server-local IFC path）", "not_selected (server-local IFC path not bound)")} prov={selectedSession ? "asbuilt" : "p1"} />
              <Field k="3D owner" v={t("A1 inline viewer lease / first frame / stage match / highlight trace", "A1 inline viewer lease / first frame / stage match / highlight trace")} prov="asbuilt" />
              <Field k="A1 auto attach" v={t("manual button only", "manual button only")} prov="asbuilt" />
            </div>
          </>}
          <p className="ec-note">{t("「建立 / 重用 MinIO 自動審查」對下方規則檢核選取的 MinIO 模型操作，只在轉檔時沒有自動建立審查（例如當時 GPU 不足）才需要。", "Create / reuse the MinIO auto review acts on the MinIO model chosen in the rule check below; it is only needed when conversion did not create a review automatically (for example, no GPU was free).")}</p>
          <div data-testid="a1-review-session-actions" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
            <Btn data-testid="a1-retry-conversion"
              disabled={!selectedMinioConversionRetryable || conversionRetryBusy}
              caption={selectedMinioConversionRetryable
                ? "POST /api/conversion/jobs/:id/retry"
                : selectedMinioJobId
                  ? t("只有 dispatch_failed / dropped_on_restart 且 source IFC ready 的 MinIO job 可在 A1 重派", "Only dispatch_failed / dropped_on_restart MinIO jobs with source IFC ready can be retried in A1")
                  : t("尚未選取 MinIO ifc-ready job", "No MinIO ifc-ready job selected")}
              onClick={() => { void retrySelectedMinioConversion(); }}>
              {conversionRetryBusy ? t("重派中…", "Retrying...") : t("重派 3D conversion", "Retry 3D conversion")}
            </Btn>
            <Btn data-testid="a1-create-review-session"
              disabled={Boolean(selectedMinioReviewSessionReason) || reviewOpenBusy}
              caption={selectedMinioReviewSessionReason || "POST /api/external/ifc-ready/:jobId/review-session"}
              onClick={() => { void ensureReviewSessionForSelectedIfcReady(); }}>
              {reviewOpenBusy ? t("建立自動審查中…", "Creating the auto review...") : t("建立 / 重用 MinIO 自動審查", "Create / reuse the MinIO auto review")}
            </Btn>
          </div>
        </details>
        {/* 回覆與錯誤放在進階區外：收合時也看得到上一個動作的結果。 */}
        {(reviewOpen || reviewOpenErr || conversionRetryErr) && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
          {reviewOpen && <span className="ec-note" data-testid="a1-review-open-url">{reviewOpen.review_session_id}</span>}
          {reviewOpenErr && <span className="ec-warn-note" data-testid="a1-review-open-error">{reviewOpenErr}</span>}
          {conversionRetryErr && <span className="ec-warn-note" data-testid="a1-conversion-retry-error">{conversionRetryErr}</span>}
        </div>}
        {a1InlineHandoff && <WorkspaceViewerMount active={active} mode="a1-inline" handoff={a1InlineHandoff}
          paneRef={issueViewerRef} onBatchGateChange={setIssueViewerGate} showHandoffActions={false} />}
      </Panel>

      <Panel title={t("規則檢核", "Rule check")} sub={t("開啟審查後，檢核來源會自動帶入同一個模型；也可改選 local_fs 或其他 MinIO 模型。只有收到回報的步驟才顯示完成。", "After a review is opened, the check source follows the same model; you can still choose local_fs or another MinIO model. A step is complete only after its result is received.")} prov="asbuilt">
        <details className="op-inline-help"><summary>{t("步驟與檢核紀錄", "Steps and check history")}</summary>
        <LifecycleStrip steps={[t("選取模型", "Select model"), t("執行檢核", "Run check"), t("檢核結果", "Results"), t("建立 Issue", "Create issues"), t("匯出交付", "Export")]} statuses={ui} />
        <div className="ec-grid" style={{ marginBottom: 8 }}>
          <Field k="rule_run_id" v={runId ?? "—"} prov="asbuilt" />
          <Field k="step" v={state.step} prov="asbuilt" />
          {state.issueCount !== null && <Field k={t("已開 issue（artifact）", "issues opened (artifact)")} v={String(state.issueCount)} prov="asbuilt" />}
          {/* EXPORT_OK 落地後才出現的可見信號：供 E2E 直接驗「exported=true（artifact）」而非靠 RUN 清 run 的旁證 disabled。
              比照 issueCount Field，僅在 state.exported 為 true 顯示；重跑保留（a1Machine：RUN 不清 exported）。 */}
          {state.exported && <div data-testid="a1-exported-artifact"><Field k={t("已匯出（artifact）", "exported (artifact)")} v="excel" prov="asbuilt" /></div>}
        </div>

        </details>
        <div data-testid="a1-source-picker" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Btn data-testid="a1-source-local" prov={sourceKind === "local_fs" ? "asbuilt" : undefined}
            caption={t("local_fs：governance-service 可讀的 server-local IFC path", "local_fs: server-local IFC path readable by governance-service")}
            onClick={() => {
              if (sourceKind !== "local_fs") {
                dispatch({ type: "RESET" });
                setActionErr(null);
                setA1Issues([]);
                setSelectedSession("");
                clearReviewOpenState();
              }
              setSelectedKey("");
              setSourceKind("local_fs");
            }}>local_fs</Btn>
          <Btn data-testid="a1-source-minio" prov={sourceKind === "minio" ? "asbuilt" : undefined}
            caption={t("MinIO：只作來源物件重驗與回看；不可直接當 ifc_source_path", "MinIO: source-object verification and backlink only; cannot be used directly as ifc_source_path")}
            onClick={() => {
              if (sourceKind !== "minio") {
                dispatch({ type: "RESET" });
                setActionErr(null);
                setA1Issues([]);
                clearReviewOpenState();
              }
              setSourceKind("minio");
            }}>MinIO</Btn>
          {sourceKind === "local_fs" ? (
            <>
              {/* option value = 唯一邏輯鍵 {projectId}/{modelId}/{version.name}（＝modelVersionId）。
                  不能用 version.path：proxy 遮蔽後所有 option 的 path 同為 "[server-path]"，
                  受控 select 會恆選第一個、且真路徑本就不該進瀏覽器。 */}
              <select data-testid="a1-localfs-select" className="ec-btn" style={{ minWidth: 520 }}
                disabled={fsTree === null || Boolean(fsErr)}
                value={selectedLocalKey}
                onChange={(e) => {
                  const nextKey = e.target.value;
                  setSelectedLocalKey(nextKey);
                  if (state.ifcPath && state.ifcPath !== `${LIBRARY_IFC_PREFIX}${nextKey}`) {
                    dispatch({ type: "RESET" });
                    setActionErr(null);
                    setA1Issues([]);
                    clearReviewOpenState();
                  }
                }}>
                <option value="">
                  {fsErr ? t("（local_fs 檔案庫不可用）", "(local_fs file library unavailable)") : fsTree === null ? t("載入中…（GET /api/governance/files/tree）", "Loading… (GET /api/governance/files/tree)") : localOptions.length === 0 ? t("（無 local_fs IFC 檔案）", "(no local_fs IFC files)") : t("— 選擇 local_fs IFC —", "— select a local_fs IFC —")}
                </option>
                {localOptions.map((option) => (
                  <option key={option.modelVersionId} value={option.modelVersionId}>
                    {testDataProjects.includes(option.projectId) ? t("〔測試資料〕", "[test data] ") : ""}{option.projectId} · {option.modelId} · {option.version.name} · {formatBytes(option.version.size_bytes)}
                  </option>
                ))}
              </select>
              <Btn data-testid="a1-step-pick" disabled={!canPickLocal}
                caption={canPickLocal ? t("鎖定檔案庫 IFC（coordinator 解析 server-local path）；只跑 CPU rule-run，不觸發轉檔", "Lock the library IFC (coordinator resolves the server-local path); run CPU rule-run only, without triggering conversion") : t("先選 local_fs IFC；MinIO object key 不能直接檢核", "Select a local_fs IFC first; a MinIO object key cannot be validated directly")}
                onClick={() => {
                  if (!selectedLocalOption) return;
                  setActionErr(null);
                  setA1Issues([]);
                  clearReviewOpenState();
                  dispatch({
                    type: "PICK_FILE",
                    // 邏輯識別（非遮蔽字面）：run 時 coordinator server-side 解析真路徑。
                    ifcPath: `${LIBRARY_IFC_PREFIX}${selectedLocalOption.modelVersionId}`,
                    modelVersionId: selectedLocalOption.modelVersionId,
                  });
                }}>{t("選取模型", "Select Model")}</Btn>
            </>
          ) : (
            <>
              <select data-testid="a1-minio-select" className="ec-btn" style={{ minWidth: 520 }}
                value={selectedKey} onChange={(e) => {
                  const nextKey = e.target.value;
                  setSelectedKey(nextKey);
                  if (state.ifcPath && selectedKey !== nextKey) {
                    dispatch({ type: "RESET" });
                    setSelectedSession("");
                    setActionErr(null);
                    setA1Issues([]);
                    clearReviewOpenState();
                  }
                }}>
                <option value="">{minioErr ? t("（MinIO 物件不可用）", "(MinIO objects unavailable)") : minioObjects === null ? t("載入中…", "Loading…") : minioObjects.length === 0 ? t("（無 source_ifc 物件）", "(no source_ifc objects)") : t("— 選擇 MinIO 模型 —", "— select a MinIO model —")}</option>
                {(minioObjects ?? []).map((o) => <option key={o.key} value={o.key}>{minioLabel(o)}</option>)}
              </select>
              <Btn data-testid="a1-step-pick" disabled={!canPickMinioDownloaded}
                caption={canPickMinioDownloaded ? t("鎖定 downloaded IFC job；coordinator 會解析 server-local IFC path", "Lock the downloaded IFC job; the coordinator resolves the server-local IFC path") : selectedMinioResolutionNote}
                onClick={() => {
                  if (!canPickMinioDownloaded || !selectedMinioObject || !selectedMinioJob) return;
                  setActionErr(null);
                  setA1Issues([]);
                  clearReviewOpenState();
                  // 有對應審查才切換共用 Viewer；沒有審查時只清 A1 目標，不拆掉正在看的 3D。
                  if (selectedMinioSessionId) selectReviewSession(selectedMinioSessionId);
                  else setSelectedSession("");
                  dispatch({
                    type: "PICK_FILE",
                    // Additional reviews do not replace the intake's original
                    // review_session_id. Address the exact intake for CPU rules.
                    ifcPath: selectedMinioSessionId && selectedMinioSessionId === selectedMinioJob.review_session_id
                      ? `session://${selectedMinioSessionId}` : `ifc-ready://${selectedMinioJob.ifc_ready_job_id}`,
                    modelVersionId: selectedMinioJob.external_model_version_id || selectedMinioObject.version || selectedMinioObject.key,
                  });
                }}>
                {selectedMinioPickLabel}
              </Btn>
            </>
          )}
        </div>
        {fsErr && sourceKind === "local_fs" && <p className="ec-warn-note" data-testid="a1-fs-error" style={{ marginTop: 4 }}>{t("local_fs 檔案庫不可用：", "local_fs file library unavailable: ")}{fsErr}{" "}<Btn data-testid="a1-fs-retry" caption="GET /api/governance/files/tree" onClick={() => { void loadA1FsTree(); }}>{t("重試載入檔案庫", "Retry loading file library")}</Btn></p>}
        {sourceKind === "local_fs" && testDataDevRoutesDisabled && <p className="ec-note" data-testid="a1-testdata-devroutes-note" style={{ marginTop: 4 }}>{t("測試資料清單暫時不可用（dev routes 已關閉，ENABLE_DEV_ROUTES=false）：local_fs 選項不會加註〔測試資料〕徽章，但不影響選檔與檢核。", "The test-data project list is temporarily unavailable (dev routes are disabled, ENABLE_DEV_ROUTES=false): local_fs options will not show the [test data] badge, but selecting and validating files is unaffected.")}</p>}
        {sourceKind === "minio" && <p className="ec-note" data-testid="a1-minio-source-note" style={{ marginTop: 4 }}>{t("A1 CPU 檢核需要 coordinator-resolved server-local IFC path；MinIO key 不會送 POST /api/governance/rule-runs。未被 watcher 偵測到的 MinIO 物件請先由轉檔排程頁觸發 POST /api/conversion/trigger。", "A1 CPU validation needs a coordinator-resolved server-local IFC path; the MinIO key is not sent to POST /api/governance/rule-runs. If the watcher missed a MinIO object, trigger POST /api/conversion/trigger from the conversion schedule page first.")}</p>}
        {sourceKind === "minio" && selectedKey && <p className={canPickMinioDownloaded ? "ec-note" : "ec-warn-note"} data-testid="a1-minio-resolution-note" style={{ marginTop: 4 }}>{selectedMinioResolutionNote}</p>}
        {minioErr && sourceKind === "minio" && <p className="ec-warn-note" data-testid="a1-minio-error" style={{ marginTop: 4 }}>{t("MinIO 物件清單不可用：", "MinIO object list unavailable: ")}{minioErr}</p>}
        {/* 顯示邏輯路徑（{project}/{model}/{version}），不再顯示遮蔽字面 "[server-path]"——
            誠實：真 server path 不進瀏覽器，由 coordinator run 時解析。 */}
        {selectedLocalOption && sourceKind === "local_fs" && <p className="ec-note" data-testid="a1-localfs-selected" style={{ marginTop: 4 }}>{t("已選 local_fs：", "Selected local_fs: ")}{selectedLocalOption.modelVersionId}</p>}
        <div className="op-ids-picker" style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
          <input className="ec-btn" data-testid="a1-ids-path" style={{ minWidth: 420 }} placeholder={t("（選填）buildingSMART IDS .ids 路徑", "(optional) buildingSMART IDS .ids path")} value={idsPath} onChange={(e) => setIdsPath(e.target.value)} />
          <input
            ref={idsFileInputRef}
            data-testid="a1-ids-file-input"
            type="file"
            accept=".ids,application/xml,text/xml"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) setIdsFileNameInCurrentDirectory(file.name);
              e.currentTarget.value = "";
            }}
          />
          <Btn data-testid="a1-ids-open-folder" caption={t("選取 .ids 後沿用目前欄位資料夾組成 server-local path", "Selecting an .ids keeps the current field folder and composes a server-local path")} onClick={() => { void openIdsFilePicker(); }}>
            {t("開啟資料夾", "Open Folder")}
          </Btn>
          <span className="ec-s">{t("預設為 repo 內 sample IDS；清空欄位則改用內建 YAML 規則集。", "Defaults to the repo sample IDS; clear the field to use the built-in YAML rule set.")}</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          {/* running-error 子態（runError=true）解除 disabled，讓「可重試」真的點得到（spec §5）；
              健康 running（輪詢中、runError=false）仍 disabled 防雙擊。 */}
          <Btn primary data-testid="a1-step-run" disabled={!canRunA1}
            caption={state.ifcPath ? (state.ifcPath.startsWith("ifc-ready://") ? "POST /api/governance/rule-runs/for-ifc-ready/:jobId" : state.ifcPath.startsWith(LIBRARY_IFC_PREFIX) ? "POST /api/governance-library/rule-runs" : selectedSession ? "POST /api/governance/rule-runs/for-session/:sessionId" : "POST /api/governance/rule-runs") : t("先選定 IFC 模型", "Select an IFC model first")} onClick={doRun}>
            {state.runError ? t("重試檢核", "Retry Validation") : state.step === "running" ? t("檢核中…", "Validating…") : t("執行規則檢核", "Run Rule Validation")}
          </Btn>
          {state.runError && <span className="ec-warn-note">{t("檢核失敗（可重試）：", "Validation failed (retryable): ")}{state.error}</span>}
        </div>
      </Panel>

      {sourceKind === "minio" && selectedKey && (
        <Panel title={t("MinIO IFC 檢核歷史", "MinIO IFC Validation History")} sub={t("依目前選取的 MinIO IFC lineage 查詢 governance rule-runs", "Queries governance rule-runs by the selected MinIO IFC lineage")} prov="asbuilt">
          <div className="ec-grid" data-testid="a1-minio-history-scope" style={{ marginBottom: 10 }}>
            <Field k={t("來源專案", "Source project")} v={selectedMinioObject?.project_display_name || selectedMinioObject?.project_id || "—"} prov="asbuilt" />
            <Field k={t("種類", "Category")} v={selectedMinioObject?.category || selectedMinioJob?.category || "—"} prov="asbuilt" />
            <Field k={t("版本", "Version")} v={selectedMinioJob?.external_model_version_id || selectedMinioObject?.version || "—"} prov="asbuilt" />
            <Field k="ifc_ready_job_id" v={selectedMinioJobId || "—"} prov={selectedMinioJobId ? "asbuilt" : "p1"} />
            <Field k="history_total" v={runHistoryTotal === null ? "—" : String(runHistoryTotal)} prov="asbuilt" />
            <Field k="rollback" v={t("not built（需版本權威 contract）", "not built (requires version authority contract)")} prov="p1" />
          </div>
          {runHistoryLoading && <p className="ec-note" data-testid="a1-minio-history-loading">{t("載入檢核歷史…", "Loading validation history...")}</p>}
          {runHistoryErr && <p className="ec-warn-note" data-testid="a1-minio-history-error">{t("檢核歷史不可用：", "Validation history unavailable: ")}{runHistoryErr}</p>}
          {!runHistoryLoading && !runHistoryErr && runHistory?.length === 0 && (
            <p className="ec-note" data-testid="a1-minio-history-empty">{t("尚無此 MinIO IFC 的檢核歷史。", "No validation history for this MinIO IFC yet.")}</p>
          )}
          {!runHistoryLoading && !runHistoryErr && runHistory && runHistory.length > 0 && (
            <table className="ec-table" data-testid="a1-minio-run-history">
              <thead><tr><th>rule_run_id</th><th>status</th><th>project</th><th>category</th><th>version</th><th>score</th><th>started_at</th></tr></thead>
              <tbody>
                {runHistory.map((row) => {
                  const meta = row.source_metadata ?? {};
                  return (
                    <tr key={row.rule_run_id}>
                      <td>{row.rule_run_id}</td>
                      <td>{row.status}</td>
                      <td>{meta.project_display_name || meta.project_id || "—"}</td>
                      <td>{meta.model_category || "—"}</td>
                      <td>{meta.model_version_id || row.model_version_id || "—"}</td>
                      <td>{row.score ?? "—"}</td>
                      <td>{row.started_at ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      )}

      {state.run && (
        <Panel title={t("結果記分板", "Result Scoreboard")} sub={t("真實 rule-run summary；點規則列展開命中構件（GUID/名稱/樓層）", "Real rule-run summary; click a rule row to expand matched elements (GUID/name/storey)")} prov="asbuilt">
          <div className="ec-grid" data-testid="a1-rulerun-scoreboard">
            {/* 記分板色碼：
                - total / passed：不加 tone，沿用 ec-metric base class（預設綠），passed=全綠語意正確
                - failed>0：tone="bad"（紅），提醒注意問題構件
                - score：<100 用 tone="warn"（琥珀），==100 用預設綠；絕不寫 tone="good"（Prov 聯集無此值，TS2322） */}
            <Metric value={state.run.summary?.total ?? "—"} label={t("規則評估次數", "Rule Evaluations")} />
            <Metric value={state.run.summary?.unique_elements ?? "—"} label={t("唯一構件", "Unique Elements")} />
            <Metric value={state.run.summary?.passed ?? "—"} label="passed" />
            <Metric
              value={state.run.summary?.failed ?? "—"}
              label="failed"
              tone={(state.run.summary?.failed ?? 0) > 0 ? "bad" : undefined}
            />
            <Metric
              value={state.run.score ?? "—"}
              label="score"
              tone={typeof state.run.score === "number" && state.run.score < 100 ? "warn" : undefined}
            />
          </div>
          {state.run.source_metadata && (
            <div className="ec-grid" data-testid="a1-run-lineage" style={{ marginTop: 12 }}>
              <Field
                k={t("來源專案", "Source project")}
                v={state.run.source_metadata.project_display_name || state.run.source_metadata.project_id || "—"}
                prov="asbuilt"
              />
              <Field
                k={t("種類", "Category")}
                v={state.run.source_metadata.model_category || "—"}
                prov="asbuilt"
              />
              <Field
                k={t("版本", "Version")}
                v={state.run.source_metadata.model_version_id || state.run.model_version_id || "—"}
                prov="asbuilt"
              />
              <Field
                k="ifc_ready_job_id"
                v={state.run.source_metadata.ifc_ready_job_id || "—"}
                prov="asbuilt"
              />
              <Field
                k="idempotency_key"
                v={state.run.source_metadata.idempotency_key || "—"}
                prov="asbuilt"
              />
              <Field
                k="source_ifc_etag"
                v={state.run.source_metadata.source_ifc_etag || "—"}
                prov="asbuilt"
              />
            </div>
          )}
        </Panel>
      )}

      <Panel title={t("在 3D 模型中顯示問題", "Show issues in the 3D model")} sub={t("需先完成規則檢核，且 3D 已連線到同一筆審查；篩選會同步模型顏色。", "Requires a completed rule check and 3D connected to the same review; filters sync the model colors.")} prov="asbuilt">
        <A1IssueViewControls rows={state.failed} runId={runId} sessionId={selectedSession}
          paneRef={issueViewerRef} gate={workspaceSlot && workspaceSlot.activeSessionId !== selectedSession
            ? { canSend: false, canSendViewerCommand: false, reason: "目前 3D Session 與這份檢核結果不同，請先選擇一致的 Session。" }
            : issueViewerGate} />
      </Panel>

      <Panel title={t("交付", "Deliverables")} sub={t("開 Issue / 匯出 Excel / 匯出 BCF 2.1 走真實後端；BCF 需先建 Issue（step=issued/delivered）才 enable；3D 高亮在上方「在 3D 模型中顯示問題」執行", "Open Issue / Export Excel / Export BCF 2.1 go through the real backend; BCF is enabled only after Issues are created (step=issued/delivered); 3D highlight runs in Show issues in the 3D model above")} prov="asbuilt">
        <div data-testid="a1-bcf-review-panel" style={{ marginBottom: 10 }}>
          <button type="button" disabled={existingIssuesBusy} onClick={() => { void loadExistingRemediationIssues(); }}>
            {existingIssuesBusy ? "載入既有問題…" : "載入既有規則問題"}
          </button>
          <div className="ec-grid" style={{ marginBottom: 8 }}>
            <Field k="BCF topics" v={exportableBcfIssues.length ? String(exportableBcfIssues.length) : t("尚未建立可匯出的正式 Issue", "no exportable formal issues created yet")} prov="asbuilt" />
            <Field k={t("匯出版本", "Export version")} v={deliveryVersionId || t("需先完成含模型版本的檢核", "Complete a run bound to a model version first")} prov={deliveryVersionId ? "asbuilt" : "p1"} />
            <Field k="scope" v={t("BCF 只匯出本次檢核版本的正式問題；下方可跨版本查看整改紀錄。", "BCF exports formal issues for this run's version; remediation history below may span versions.")} prov="asbuilt" />
          </div>
          {bcfIssues.length === 0 ? (
            <p className="ec-note">{t("先按「失敗構件建 Issue」後，這裡才會列出可追蹤的 BCF topics；未建 Issue 前 BCF 匯出保持 disabled。", "Create Issues for Failed Elements first; this panel then lists trackable BCF topics. BCF export stays disabled before issues exist.")}</p>
          ) : (
            <table className="ec-table">
              <thead><tr><th>topic</th><th>model_version_id</th><th>rule_code</th><th>severity</th><th>status</th><th>assignee</th><th>ifc_guid</th><th>action</th></tr></thead>
              <tbody>
                {bcfIssues.map((issue) => {
                  const next = issue.status === "open" ? "in_progress" : issue.status === "in_progress" && issue.source_type !== "rule_result" ? "resolved" : null;
                  return (
                    <tr key={issue.id}>
                      <td>{issue.title}</td>
                      <td>{issue.model_version_id || "—"}</td>
                      <td>{issue.rule_code ?? "—"}</td>
                      <td>{issue.severity}</td>
                      <td>{issue.status}</td>
                      <td><span className="ec-cap">{t("指派 pending", "assignee pending")}</span></td>
                      <td>{issue.ifc_guid ?? "—"}</td>
                      <td>
                        <Btn data-testid={`a1-issue-transition-${issue.id}`} disabled={!next}
                          caption={next ? `POST /api/governance/issues/${issue.id}/transition -> ${next}` : t("已是終態或不支援轉移", "terminal or unsupported transition")}
                          onClick={() => { void transitionA1Issue(issue); }}>
                          {next ?? t("無下一步", "No next step")}
                        </Btn>
                        {issue.source_type === "rule_result" && <>
                          <button type="button" onClick={() => setRemediationSelection({ id: issue.id, runId, version: state.modelVersionId, mode: "history" })}>查看整改紀錄</button>
                          <button type="button" onClick={() => setRemediationSelection({ id: issue.id, runId, version: state.modelVersionId, mode: "confirm" })}>核對整改</button>
                        </>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {remediation?.mode === "history" && <RemediationHistoryPanel key={remediation.id} issueId={remediation.id} onIssueChanged={updateRemediationIssue}/>}
        {remediation?.mode === "confirm" && <RemediationConfirmationPanel key={remediation.id} issueId={remediation.id} onIssueChanged={updateRemediationIssue}/>}
        <Btn data-testid="a1-step-issues" disabled={state.step === "idle" || state.step === "picked" || state.step === "running"}
          caption="POST /api/governance/issues/from-rule-run/:id" onClick={makeIssues}>{t("失敗構件建 Issue", "Create Issues for Failed Elements")}</Btn>{" "}
        {/* export 與 a1-step-issues 共用 state-machine gating（step ∈ {scored,issued,delivered} 才 enable），
            不看 state.run 快照欄位：重跑 running 子態 RUN_PROGRESS 可能短暫帶 succeeded 快照（step 仍 running），
            舊式 disabled={!runId||run?.status!=="succeeded"} 會在該瞬間誤解除 disabled、允許 running 子態匯出。 */}
        <Btn data-testid="a1-step-export" disabled={state.step === "idle" || state.step === "picked" || state.step === "running" || excelBusy}
          caption="GET /api/governance/rule-runs/:id/export?fmt=excel" onClick={doExport}>{t("匯出 Excel", "Export Excel")}</Btn>{" "}
        {/* A1-W1 BCF 2.1 匯出鈕（#a1 canonical route；#issues 標 legacy）。
            gating：step ∈ {issued, delivered} 才 enable（需先建 Issue），scored/running/idle 時 disabled + caption 說明。
            重用 Issues 頁 bcfExportUrl() + 相同 fetch→blob→a.click→appendChild/removeChild→setTimeout revoke 下載慣例。
            後端 404（無正式 issue 或無 ifc_guid）走 actionErr 誠實顯示。prov=asbuilt。 */}
        {(() => {
          // F1：bcfEnabled 同時檢查 issuesCreated（獨立追蹤「曾真正建過 Issue」）與 step。
          // scored→EXPORT_OK→delivered 不經 CREATE_ISSUES_OK，issuesCreated 仍 false → BCF disabled。
          const bcfEnabled = state.issuesCreated && exportableBcfIssues.length > 0 && (state.step === "issued" || state.step === "delivered");
          return (
            <>
              <Btn
                data-testid="a1-step-bcf"
                prov="asbuilt"
                disabled={!bcfEnabled || bcfBusy}
                caption={bcfEnabled ? t("匯出本次檢核版本的正式問題", "Export formal issues for this run's version") : t("需先建 Issue，且檢核與問題須含相同模型版本", "Create Issues first with the same model version as the run")}
                onClick={async () => {
                  if (!bcfEnabled || deliveryBusy.current.bcf) return;
                  const generation = deliveryGeneration.current;
                  deliveryBusy.current.bcf = true;
                  setActionErr(null);
                  setBcfBusy(true);
                  try {
                    const res = await fetch(governanceClient.bcfExportUrl({ model_version_id: deliveryVersionId }));
                    if (generation !== deliveryGeneration.current) return;
                    if (!res.ok) { setActionErr(`${t("BCF 匯出 ", "BCF export ")}${res.status}${t("：需至少一個正式 issue（kind=issue 且有 ifc_guid）", ": at least one formal issue is required (kind=issue with ifc_guid)")}`); return; }
                    const blob = await res.blob();
                    if (generation !== deliveryGeneration.current) return;
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "governance-issues.bcfzip";
                    // 錨點須掛載於 document 才觸發下載：Gecko / 部分 Edge 對 detached <a> 下載不可靠。
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    // 延後釋放 object URL：同步 revoke 會在瀏覽器開始讀取 blob 前就釋放（對齊 doExport 延後模式）。
                    setTimeout(() => URL.revokeObjectURL(a.href), 0);
                    dispatch({ type: "BCF_EXPORT_OK" });
                  } catch (e) {
                    if (generation === deliveryGeneration.current) setActionErr(`${t("BCF 匯出失敗：", "BCF export failed: ")}${String(e)}`);
                  } finally {
                    if (generation === deliveryGeneration.current) { deliveryBusy.current.bcf = false; setBcfBusy(false); }
                  }
                }}
              >
                {t("匯出 BCF 2.1", "Export BCF 2.1")}
              </Btn>
              {/* F4：BCF_EXPORT_OK 落地後才出現的可見信號（對齊 Excel EXPORT_OK → a1-exported-artifact）。 */}
              {state.bcfExported && <div data-testid="a1-bcf-exported-artifact"><Field k={t("已匯出（artifact）", "exported (artifact)")} v="bcf" prov="asbuilt" /></div>}
            </>
          );
        })()}{" "}
        {/* F2⑩：回拋摘要至雲端（issue/檢核統計 metadata-only → coordinator callback outbox）。
            證據型：202 只代表已入列 outbox（顯 outbox_id）；遞送成敗到 #conv 轉檔歷史頁的
            Callback Outbox 摘要面板觀察，不在此偽造「已送達雲端」。 */}
        <Btn
          data-testid="a1-issue-snapshot"
          prov="asbuilt"
          disabled={!canIssueSnapshot || issueSnapshotBusy}
          title={canIssueSnapshot ? undefined : issueSnapshotReason}
          caption={canIssueSnapshot ? "POST /api/review-sessions/:sessionId/issue-snapshot" : issueSnapshotReason}
          onClick={() => { void doIssueSnapshot(); }}
        >
          {issueSnapshotBusy ? t("回拋中…", "Sending snapshot…") : t("回拋摘要至雲端", "Send Summary Snapshot to Cloud")}
        </Btn>{" "}
        {issueSnapshotOutboxId && (
          <div className="ec-note" data-testid="a1-issue-snapshot-result">
            {t("已入列 outbox：", "Enqueued to outbox: ")}<code>{issueSnapshotOutboxId}</code>{" "}
            <a href="#conv">{t("→ 到 IFC→USD 轉檔歷史頁看 outbox 遞送狀態", "→ see outbox delivery status on the IFC→USD conversion history page")}</a>
            <A1OutboxStatus key={`${issueSnapshotSessionId}:${issueSnapshotOutboxId}`} outboxId={issueSnapshotOutboxId} sessionId={issueSnapshotSessionId} />
          </div>
        )}
        {issueSnapshotErr && <span className="ec-warn-note" data-testid="a1-issue-snapshot-error">{issueSnapshotErr}</span>}{" "}
        {/* 七軸 cross-link chips（§4.3）：回看 MinIO 來源物件、跳 Session 管理檢視此 session。
            證據型——目標 id 不存在時誠實 disabled，不製造無效跳轉。 */}
        <span className="ec-crosslinks" data-testid="a1-crosslinks" style={{ display: "inline-flex", gap: 8, flexWrap: "wrap", marginLeft: 8 }}>
          <Btn
            data-testid="a1-link-minio"
            disabled={sourceKind !== "minio" || !selectedKey}
            caption={sourceKind === "minio" && selectedKey ? t("回看 MinIO 來源物件", "View the source object in MinIO") : t("尚未選取 MinIO 物件", "No MinIO object selected")}
            // as-built（既知差異，spec §4.3 A1→M 表下註）：spec 範例寫 prefix，本 chip 刻意送 minio_key（更精確，
            // 指向確切檔案；M 端做 key-level 重驗）。minio_key 本就列於 §4.3「帶的 ID」欄，屬合規選擇。M 的 prefix
            // 收件分支保留供未來「純資料夾回看」按鈕，目前無真實按鈕發送 prefix。
            onClick={() => { if (sourceKind !== "minio" || !selectedKey) return; window.location.hash = buildHandoff("minio", { source: "a1", minio_key: selectedKey }); }}
          >
            {t("MinIO 來源 →", "MinIO source →")}
          </Btn>
          <Btn
            data-testid="a1-link-sessions"
            disabled={!selectedSession}
            caption={selectedSession ? t("在 Session 管理檢視此 session", "View this session in Session Management") : t("尚未選取 review session", "No review session selected")}
            onClick={() => { if (!selectedSession) return; window.location.hash = buildHandoff("sessions", { source: "a1", session: selectedSession }); }}
          >
            {t("Session 管理 →", "Session Management →")}
          </Btn>
        </span>{" "}
        {actionErr && <p className="ec-warn-note" data-testid="a1-action-error" style={{ marginTop: 8 }}>{actionErr}</p>}
      </Panel>
    </>
  );
}
