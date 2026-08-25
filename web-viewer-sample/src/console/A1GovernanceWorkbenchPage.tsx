// A1 governance workbench and its private helpers.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "./i18n";
import { Btn, Field, Metric, Panel } from "./components";
import { uiSteps } from "./a1Machine";
import { useRuleRun } from "./hooks/useRuleRun";
import type { RuleRunSource } from "./hooks/useRuleRun";
import { FileProjectRow, FileVersionRow, governanceClient, IssueRow, LIBRARY_IFC_PREFIX, parseLibraryIfcPath, RuleResultRow, RuleRunHistoryFilters, RuleRunHistoryItem } from "./governanceClient";
import { coordinatorClient, isCoordinatorNotFound, IfcReadyListItem, IfcReadyReviewSessionResponse, RuntimeSessionSummary, RuntimeStatus } from "./coordinatorClient";
import { LifecycleStrip } from "./modelData/conversionShared";
import { ReviewSessionViewerPane, type ReviewRoomHandoff } from "./ReviewSessionViewerPane";
import { ElementMappingDocument, isFakeMappingDocument, isFakeMappingItem } from "../types/mapping";
import { buildHandoff } from "./handoff";
import { useIncomingHandoff, IncomingHandoffBanner } from "./incomingHandoff";
import { FailureScoreboard } from "./FailureScoreboard";
type NativeFilePickerWindow = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<Array<{ name: string }>>;
};

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
export function A1GovernanceWorkbenchPage() {
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
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [runHistory, setRunHistory] = useState<RuleRunHistoryItem[] | null>(null);
  const [runHistoryTotal, setRunHistoryTotal] = useState<number | null>(null);
  const [runHistoryErr, setRunHistoryErr] = useState<string | null>(null);
  const [runHistoryLoading, setRunHistoryLoading] = useState(false);
  const [runHistoryRefreshTick, setRunHistoryRefreshTick] = useState(0);
  const [reviewOpen, setReviewOpen] = useState<IfcReadyReviewSessionResponse | null>(null);
  const [reviewOpenBusy, setReviewOpenBusy] = useState(false);
  const [reviewOpenErr, setReviewOpenErr] = useState<string | null>(null);
  const [conversionRetryBusy, setConversionRetryBusy] = useState(false);
  const [conversionRetryErr, setConversionRetryErr] = useState<string | null>(null);
  const idsFileInputRef = useRef<HTMLInputElement>(null);
  // R8：local_fs 測試 fixtures 專案清單（coordinator config 驅動）。取不到＝空清單＝不標，
  // 誠實降級不阻塞選檔（MinIO 為真實資料監控來源，不標測試資料）。
  const [testDataProjects, setTestDataProjects] = useState<string[]>([]);
  // Task 4C：ENABLE_DEV_ROUTES=false 時 GET /api/dev/test-data-projects 也在 /api/dev/* 404 gate 內
  // （PR #691 D3）。誠實鐵律：404 是「dev routes 已關閉」這個可解釋的已知狀態，不是普通取不到——
  // 顯示 note 讓操作員知道〔測試資料〕徽章暫時不會出現的原因；非 404 的其他失敗維持既有靜默降級
  // （取不到就不標；不擋 A1 流程），不誤報成 dev routes 問題。
  const [testDataDevRoutesDisabled, setTestDataDevRoutesDisabled] = useState(false);
  useEffect(() => {
    let alive = true;
    coordinatorClient.getTestDataProjects()
      .then((r) => { if (alive) { setTestDataProjects(r.projects); setTestDataDevRoutesDisabled(false); } })
      .catch((e) => {
        if (!alive) return;
        if (isCoordinatorNotFound(e)) setTestDataDevRoutesDisabled(true);
        /* 非 404：取不到就不標；不擋 A1 流程 */
      });
    return () => { alive = false; };
  }, []);
  const ui = uiSteps(state);
  const issueGenRef = useRef(0);
  const issueGuardRef = useRef({ runId: null as string | null, modelVersionId: "" });
  useEffect(() => {
    issueGuardRef.current = { runId, modelVersionId: state.modelVersionId };
    issueGenRef.current += 1;
  }, [runId, state.modelVersionId, state.ifcPath]);
  // F2⑩：run 或 session 變更即清掉上次回拋結果/錯誤——舊 run 的 outbox_id 對新 run 無意義，
  // 殘留會誤導操作員以為新 run 已回拋（RESET 走 runId→null 同樣命中此 effect）。
  useEffect(() => {
    setIssueSnapshotOutboxId(null);
    setIssueSnapshotErr(null);
  }, [runId, selectedSession]);

  const clearReviewOpenState = useCallback(() => {
    setReviewOpen(null);
    setReviewOpenErr(null);
  }, []);
  // Task 14（M→A1 接收端重驗）：向已抓取的 minioObjects 重驗 incoming minio_key；查無 → 誠實 not_found。
  // Task14 Important #1：minioObjects===null=尚未載入（見上方 state 註解）。載入中不得壓成 not_found（掛載後
  // 第一個 fetch resolve 前的同步 render 會誤閃假警示），回中性 indeterminate；已載入（[] 或有值）才判 not_found。
  const incoming = useIncomingHandoff("a1", (h) => {
    // 本軸只重驗 minio_key；SS→A1 chip 只帶 session（A1 不重驗 session）→ 無欄位可查＝not_applicable，
    // 不得誤成 not_found（否則對真實 active session 假報「查無」；p5-critic honesty regression）。
    if (!h.minio_key) return "not_applicable";
    if (minioObjects === null) return "indeterminate";
    // reviewer P2（Codex，已核實）：getMinioObjects() 失敗時 catch 分支把 minioObjects 落成 []（非 null），
    // 上面的 null 守門不再成立，未查即誤報 not_found（MinIO 斷線/憑證缺失時對真實 handoff 假警示紅字）。
    // minioErr 非 null＝本來就沒查成功，比照 null 分支同樣退 indeterminate，不假裝已查無。
    if (minioErr !== null) return "indeterminate";
    return minioObjects.some((o) => o.key === h.minio_key);
  });
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

  // Mount 時只列出可手動選取的 active/created session。不得自動選 act[0]；
  // 3D attach/lease 由 A1 inline viewer pane 的明確按鈕啟動。
  useEffect(() => {
    let alive = true;
    coordinatorClient.runtimeStatus()
      .then((rt) => {
        if (!alive) return;
        const act = rt.sessions.items.filter((s) => s.status === "active" || s.status === "created");
        setSessions(act);
      })
      .catch(() => { if (alive) setSessions([]); }); // 連不上就空，不假資料
    return () => { alive = false; };
  }, []);

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

  const selectedMinioObject = sourceKind === "minio"
    ? (minioObjects ?? []).find((o) => o.key === selectedKey) ?? null
    : null;

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
          ? refreshedJobs.find((job) => job.idempotency_key === selectedMinioObject.idempotency_key) ?? null
          : expectedIfcReadyJobId
            ? refreshedJobs.find((job) => job.ifc_ready_job_id === expectedIfcReadyJobId) ?? null
            : refreshedJobs.find((job) => job.review_session_id === selectedSession) ?? null;
        const refreshedSourceIfcReady =
          refreshedJob?.download_status === "downloaded"
          && (!ifcPath.startsWith("session://") || refreshedJob.review_session_id === selectedSession)
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
  }, [state.step, state.ifcPath, state.modelVersionId, idsPath, selectedSession, sessions, selectedMinioObject, sourceKind, refreshIfcReadyJobs, runRuleRun]);

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
      setActionErr(`${t("建 Issue 失敗：", "Failed to create Issue: ")}${String(e)}`);
    }
  }, [runId, state.modelVersionId, dispatch]);

  const doExport = useCallback(async () => {
    if (!runId) return;
    setActionErr(null); // 重試前清掉上次錯誤
    setExcelBusy(true);
    try {
      const res = await fetch(governanceClient.exportUrl(runId));
      if (!res.ok) { setActionErr(`${t("匯出失敗：HTTP ", "Export failed: HTTP ")}${res.status}`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      // 錨點須掛載於 document 才觸發 .click()：Firefox（Gecko）與部分 Edge 對 detached <a> 下載不可靠，
      // 會靜默失敗（EXPORT_OK 永不 dispatch、UI 卡 scored 無回饋，違誠實鐵律）。appendChild→click→removeChild
      // 為跨瀏覽器最安全慣例。
      const a = document.createElement("a"); a.href = url; a.download = `rule-run-${runId}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 0);
      dispatch({ type: "EXPORT_OK" });
    } catch (e) {
      setActionErr(`${t("匯出失敗：", "Export failed: ")}${String(e)}`); // 誠實顯示失敗，不靜默
    } finally {
      setExcelBusy(false);
    }
  }, [runId, dispatch]);

  const transitionA1Issue = useCallback(async (issue: IssueRow) => {
    const next = issue.status === "open" ? "in_progress" : issue.status === "in_progress" ? "resolved" : null;
    if (!next) return;
    setActionErr(null);
    try {
      const updated = await governanceClient.transitionIssue(issue.id, next, "A1 BCF review panel transition");
      setA1Issues((items) => items.map((item) => item.id === updated.id ? updated : item));
    } catch (e) {
      setActionErr(`${t("Issue 狀態更新失敗：", "Issue transition failed: ")}${String(e)}`);
    }
  }, []);

  // F2⑩ gating：rule-run 成功（step 進 scored/issued/delivered）且來源含 session 脈絡
  //（for-session 模式 ifcPath=session://… 且已選 session）才可回拋。local_fs / for-ifc-ready
  // 無 session → 誠實 disabled：coordinator route 以 review session 為錨（correlation_id=session_id），
  // 無 session 無從綁定，不做假成功。
  const issueSnapshotSessionId = state.ifcPath.startsWith("session://") ? selectedSession : "";
  const issueSnapshotRunSucceeded = Boolean(runId) && ["scored", "issued", "delivered"].includes(state.step);
  const canIssueSnapshot = issueSnapshotRunSucceeded && Boolean(issueSnapshotSessionId);
  const issueSnapshotReason = !issueSnapshotRunSucceeded
    ? t("需先成功完成 rule-run 檢核", "Run a successful rule-run first")
    : t("需 review session 脈絡（F2⑩ 綁 session）", "Requires review session context (F2⑩ binds the session)");
  const doIssueSnapshot = useCallback(async () => {
    if (!runId || !issueSnapshotSessionId) return;
    setIssueSnapshotBusy(true);
    setIssueSnapshotErr(null);
    setIssueSnapshotOutboxId(null);
    try {
      const res = await coordinatorClient.postIssueSnapshot(issueSnapshotSessionId, {
        rule_run_id: runId,
        ...(state.modelVersionId ? { model_version_id: state.modelVersionId } : {}),
      });
      setIssueSnapshotOutboxId(res.outbox_id);
    } catch (e) {
      // 502＝coordinator 查 governance 統計失敗、未入列（後端誠實不偽造統計）；其餘照實顯示。
      const message = String(e);
      setIssueSnapshotErr(message.includes("governance_unreachable")
        ? `${t("governance 不可達，摘要未入列：", "governance unreachable; the snapshot was not enqueued: ")}${message}`
        : `${t("回拋失敗：", "Snapshot failed: ")}${message}`);
    } finally {
      setIssueSnapshotBusy(false);
    }
  }, [runId, issueSnapshotSessionId, state.modelVersionId]);

  // A1（B2）下拉項 label：專案·種類·版本·檔名（缺值以「?」誠實標示，不臆造）。
  const minioLabel = (o: import("./coordinatorClient").MinioObject) =>
    `${o.project_display_name ?? o.project_id ?? "?"} · ${o.category ?? "?"} · ${o.version ?? "?"} · ${o.key.split("/").pop() ?? o.key}`;

  const localOptions = flattenA1LocalVersions(fsTree ?? []);
  // 以唯一邏輯鍵（modelVersionId）比對——version.path 被 proxy 遮蔽後全部同值，不能當鍵。
  const selectedLocalOption = localOptions.find((option) => option.modelVersionId === selectedLocalKey) ?? null;
  const canPickLocal = sourceKind === "local_fs" && Boolean(selectedLocalOption);
  const selectedMinioJob = selectedMinioObject && ifcReadyJobs
    ? ifcReadyJobs.find((job) => job.idempotency_key === selectedMinioObject.idempotency_key) ?? null
    : null;
  const selectedMinioSessionId = selectedMinioJob?.review_session_id ?? "";
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
  const selectedMinioResolutionNote = !selectedKey
    ? t("請先選擇 MinIO source_ifc 物件。", "Select a MinIO source_ifc object first.")
    : ifcReadyErr
      ? `${t("ifc-ready job 清單不可用：", "ifc-ready job list unavailable: ")}${ifcReadyErr}`
      : ifcReadyJobs === null
        ? t("正在載入 watcher downloaded ifc-ready jobs…", "Loading watcher downloaded ifc-ready jobs...")
        : !selectedMinioJob
          ? `${t("尚未找到 watcher 下載紀錄；A1 不會直接檢核 MinIO key。請用 MinIO/IFC->USD 排程頁觸發 POST /api/conversion/trigger。idempotency_key=", "No watcher download record found; A1 will not validate a MinIO key directly. Use the MinIO/IFC->USD schedule page to trigger POST /api/conversion/trigger. idempotency_key=")}${selectedMinioObject?.idempotency_key ?? "unknown"}`
          : !selectedMinioDownloaded
            ? `${t("watcher job 尚未下載完成，A1 等待 downloaded 狀態。download_status=", "Watcher job is not downloaded yet; A1 waits for downloaded status. download_status=")}${selectedMinioJob.download_status ?? "unknown"}${selectedMinioJob.download_failure ? ` (${selectedMinioJob.download_failure})` : ""}`
            : !selectedMinioSourceIfcReady
              ? `${t("watcher job 已下載，但 source IFC artifact stale；A1 不啟動 rule-run：", "Watcher job is downloaded, but the source IFC artifact is stale; A1 will not start a rule-run: ")}${selectedMinioSourceIfcStaleReason}`
              : selectedMinioSessionId
                ? `${t("已對到 watcher downloaded job 與 review session；rule-run 將走 coordinator for-session proxy：", "Matched watcher downloaded job and review session; rule-run will use coordinator for-session proxy: ")}${selectedMinioJob.ifc_ready_job_id} / ${selectedMinioSessionId}`
                : `${t("已對到 watcher downloaded job；coordinator ifc-ready proxy（POST /api/governance/rule-runs/for-ifc-ready）只排入 A1 governance rule-run queue：", "Matched watcher downloaded job; coordinator ifc-ready proxy (POST /api/governance/rule-runs/for-ifc-ready) queues only the A1 governance rule-run: ")}${selectedMinioJob.ifc_ready_job_id}`;
  const selectedMinioPickLabel = canPickMinioDownloaded
    ? t("選取已下載模型", "Select Downloaded Model")
    : !selectedKey
      ? t("等待選擇 MinIO 模型", "Waiting for MinIO model")
      : ifcReadyJobs === null
        ? t("載入 downloaded jobs", "Loading downloaded jobs")
        : !selectedMinioJob
          ? t("等待 watcher/轉檔排程", "Waiting for watcher/conversion schedule")
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
    try {
      const res = await coordinatorClient.createReviewSessionForIfcReady(selectedMinioJobId);
      setReviewOpen(res);
      setSelectedSession(res.review_session_id);
      setSessions((items) => {
        const summary: RuntimeSessionSummary = {
          session_id: res.review_session_id,
          status: res.session_status,
          project_id: selectedMinioJob.project_id,
          model_version_id: selectedMinioJob.external_model_version_id,
          participant_count: 0,
          expected_stage_url: res.expected_stage_url,
          expected_mapping_url: res.expected_mapping_url,
          conversion_status: res.conversion_status,
          kit_instance_ids: [],
          created_at: "",
          updated_at: "",
          first_frame_at: null,
          artifact_health: res.artifact_health ?? null,
        };
        return items.some((item) => item.session_id === res.review_session_id)
          ? items.map((item) => item.session_id === res.review_session_id ? { ...item, ...summary } : item)
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
      setReviewOpenErr(String(e));
      return null;
    } finally {
      setReviewOpenBusy(false);
    }
  }, [selectedMinioConversionReady, selectedMinioJob, selectedMinioJobId, selectedMinioReviewSessionReason, selectedMinioSessionId]);

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

  const selectedReviewExpectedStageUrl = reviewOpen?.expected_stage_url ?? selectedSessionSummary?.expected_stage_url ?? null;
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
      <p className="ec-lead">{t("選取 MinIO 偵測到的 IFC，讓 coordinator 綁定 server-local IFC path，再跑 governance-service CPU 規則檢核；IFC→USD ready 後，A1 本頁可直接建立 / 選擇 3D session、attach viewer lease，並送出高亮。", "Select a MinIO-detected IFC, let the coordinator bind the server-local IFC path, then run governance-service CPU validation; once IFC->USD is ready, A1 can directly create / select the 3D session, attach the viewer lease, and send highlights on this page.")}</p>

      <Panel title={t("A1 五步引導式流程", "A1 Five-Step Guided Workflow")} sub={t("整頁狀態機驅動；步驟依當前 state 亮燈（證據型更新，禁樂觀）", "Driven by a page-level state machine; steps light up by current state (evidence-based updates, no optimistic UI)")} prov="asbuilt">
        <LifecycleStrip steps={[t("選 IFC", "Select IFC"), t("選 IDS", "Select IDS"), t("執行檢核", "Run Validation"), t("3D Session", "3D Session"), t("高亮審查/交付", "Highlight Review / Deliver")]} statuses={ui} />
        <div className="ec-grid" style={{ marginBottom: 8 }}>
          <Field k="rule_run_id" v={runId ?? "—"} prov="asbuilt" />
          <Field k="step" v={state.step} prov="asbuilt" />
          {state.issueCount !== null && <Field k={t("已開 issue（artifact）", "issues opened (artifact)")} v={String(state.issueCount)} prov="asbuilt" />}
          {/* EXPORT_OK 落地後才出現的可見信號：供 E2E 直接驗「exported=true（artifact）」而非靠 RUN 清 run 的旁證 disabled。
              比照 issueCount Field，僅在 state.exported 為 true 顯示；重跑保留（a1Machine：RUN 不清 exported）。 */}
          {state.exported && <div data-testid="a1-exported-artifact"><Field k={t("已匯出（artifact）", "exported (artifact)")} v="excel" prov="asbuilt" /></div>}
        </div>

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
                  setSelectedSession(selectedMinioSessionId);
                  dispatch({
                    type: "PICK_FILE",
                    ifcPath: selectedMinioSessionId ? `session://${selectedMinioSessionId}` : `ifc-ready://${selectedMinioJob.ifc_ready_job_id}`,
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
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
          {runId && state.failed.length > 0 && <FailureScoreboard runId={runId} failed={state.failed} />}
        </Panel>
      )}

      <Panel title={t("A1 3D 高亮 Session", "A1 3D highlight session")} sub={t("MinIO 來源先由 coordinator 建立 / 重用 review session；A1 本頁直接 attach viewer、觀測 first frame / DataChannel / stage match，並送出 3D 高亮。", "MinIO sources create or reuse a review session through the coordinator; A1 attaches the viewer, observes first frame / DataChannel / stage match, and sends 3D highlight on this page.")} prov="asbuilt">
        {sessions.length === 0 ? (
          <div data-testid="a1-no-session">
            <p className="ec-note">{t("無 active session。若已有 downloaded IFC-ready job，A1 仍可先跑 CPU rule-run；3D 高亮需先讓 IFC→USD conversion ready，再在本頁建立 / 啟動 3D session。", "No active session. If a downloaded IFC-ready job exists, A1 can still run the CPU rule-run; 3D highlight requires IFC->USD conversion ready, then the 3D session is created and started on this page.")}</p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Btn data-testid="a1-trigger-convert" disabled
                caption={t("A1 v2 不觸發 conversion；請到 IFC→USD 轉檔排程頁操作", "A1 v2 does not trigger conversion; use the IFC→USD schedule page")}>
                {t("A1 不排入轉檔", "A1 does not queue conversion")}
              </Btn>
              <a className="ec-s" data-testid="a1-conv-link" href={buildHandoff("minio", { source: "a1", minio_key: sourceKind === "minio" ? selectedKey || undefined : undefined })}>{t("查看 MinIO 來源 →", "View MinIO source →")}</a>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <label>review session</label>
              {/* 切換 session 必須同時重置 rule-run 結果（RESET → initialA1State）：
                  rule 結果是針對特定 session 的 mapping enrich 過的；切換 session 後必須重跑檢核，避免把舊 session 的
                  failed rows handoff 到新 session。 */}
              <select data-testid="a1-session-select" value={selectedSession} onChange={(e) => {
                const nextSession = e.target.value;
                if (nextSession === selectedSession) return;
                setSelectedSession(nextSession);
              }}>
                <option value="">{t("— 手動選擇 review session —", "— manually select a review session —")}</option>
                {sessions.map((s) => <option key={s.session_id} value={s.session_id}>{s.session_id}（{s.status}）</option>)}
              </select>
            </div>
            <div className="ec-grid" style={{ marginBottom: 8 }}>
              <Field k="selected session" v={selectedSession || t("not_selected（未綁定 server-local IFC path）", "not_selected (server-local IFC path not bound)")} prov={selectedSession ? "asbuilt" : "p1"} />
              <Field k="3D owner" v={t("A1 inline viewer lease / first frame / stage match / highlight trace", "A1 inline viewer lease / first frame / stage match / highlight trace")} prov="asbuilt" />
              <Field k="A1 auto attach" v={t("manual button only", "manual button only")} prov="asbuilt" />
            </div>
          </>
        )}
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
            {reviewOpenBusy ? t("建立 3D Session 中…", "Creating 3D Session...") : t("建立 / 重用 3D Session", "Create / Reuse 3D Session")}
          </Btn>
          {reviewOpen && <span className="ec-note" data-testid="a1-review-open-url">{reviewOpen.review_session_id}</span>}
          {reviewOpenErr && <span className="ec-warn-note" data-testid="a1-review-open-error">{reviewOpenErr}</span>}
          {conversionRetryErr && <span className="ec-warn-note" data-testid="a1-conversion-retry-error">{conversionRetryErr}</span>}
        </div>
        {a1InlineHandoff && <ReviewSessionViewerPane mode="a1-inline" handoff={a1InlineHandoff} />}
      </Panel>

      <Panel title={t("交付", "Deliverables")} sub={t("開 Issue / 匯出 Excel / 匯出 BCF 2.1 走真實後端；BCF 需先建 Issue（step=issued/delivered）才 enable；3D 高亮在 A1 本頁 session 面板執行", "Open Issue / Export Excel / Export BCF 2.1 go through the real backend; BCF is enabled only after Issues are created (step=issued/delivered); 3D highlight runs in the A1 session panel above")} prov="asbuilt">
        <div data-testid="a1-bcf-review-panel" style={{ marginBottom: 10 }}>
          <div className="ec-grid" style={{ marginBottom: 8 }}>
            <Field k="BCF topics" v={bcfIssues.length > 0 ? String(bcfIssues.length) : t("尚未建立可匯出的正式 Issue", "no exportable formal issues created yet")} prov={bcfIssues.length > 0 ? "asbuilt" : "p1"} />
            <Field k="scope" v={t("只列 kind=issue 且含 ifc_guid 的 BCF topics；annotation 不計入", "only kind=issue rows with ifc_guid are listed as BCF topics; annotations are excluded")} prov="asbuilt" />
          </div>
          {bcfIssues.length === 0 ? (
            <p className="ec-note">{t("先按「失敗構件建 Issue」後，這裡才會列出可追蹤的 BCF topics；未建 Issue 前 BCF 匯出保持 disabled。", "Create Issues for Failed Elements first; this panel then lists trackable BCF topics. BCF export stays disabled before issues exist.")}</p>
          ) : (
            <table className="ec-table">
              <thead><tr><th>topic</th><th>rule_code</th><th>severity</th><th>status</th><th>assignee</th><th>ifc_guid</th><th>action</th></tr></thead>
              <tbody>
                {bcfIssues.map((issue) => {
                  const next = issue.status === "open" ? "in_progress" : issue.status === "in_progress" ? "resolved" : null;
                  return (
                    <tr key={issue.id}>
                      <td>{issue.title}</td>
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
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
          const bcfEnabled = state.issuesCreated && bcfIssues.length > 0 && (state.step === "issued" || state.step === "delivered");
          return (
            <>
              <Btn
                data-testid="a1-step-bcf"
                prov="asbuilt"
                disabled={!bcfEnabled || bcfBusy}
                caption={bcfEnabled ? t("GET /api/governance/bcf/export（只含正式 issue）", "GET /api/governance/bcf/export (formal issues only)") : t("需先建 Issue（step=issued/delivered）", "Create Issues first (step=issued/delivered)")}
                onClick={async () => {
                  if (!bcfEnabled) return;
                  setActionErr(null);
                  setBcfBusy(true);
                  try {
                    const res = await fetch(governanceClient.bcfExportUrl());
                    if (!res.ok) { setActionErr(`${t("BCF 匯出 ", "BCF export ")}${res.status}${t("：需至少一個正式 issue（kind=issue 且有 ifc_guid）", ": at least one formal issue is required (kind=issue with ifc_guid)")}`); return; }
                    const blob = await res.blob();
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
                  } catch (e) { setActionErr(`${t("BCF 匯出失敗：", "BCF export failed: ")}${String(e)}`); }
                  finally { setBcfBusy(false); }
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
          <span className="ec-note" data-testid="a1-issue-snapshot-result">
            {t("已入列 outbox：", "Enqueued to outbox: ")}<code>{issueSnapshotOutboxId}</code>{" "}
            <a href="#conv">{t("→ 到 IFC→USD 轉檔歷史頁看 outbox 遞送狀態", "→ see outbox delivery status on the IFC→USD conversion history page")}</a>
          </span>
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
