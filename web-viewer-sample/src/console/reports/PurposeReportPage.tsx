import { useEffect, useRef, useState } from "react";
import { ReportHttpError, validationReportClient, type HistoryItem, type Purpose, type ValidationReport, type ReportModel } from "./validationReportClient";
import "./purpose-report.css";

const purposes: [Purpose, string][] = [["view_3d","3D 檢視"],["locate_highlight","構件定位與高亮"],["distance_measurement","距離量測"],["ifc_rules","IFC 規則檢核"]];
const outcomes = { usable:"可使用", usable_with_limits:"有限制可使用", not_usable:"不可使用", not_validated:"尚未驗證" };
const failure = (error: unknown) => error instanceof ReportHttpError && error.status === 403
  ? "沒有此報表的存取權限，請聯絡專案管理者。"
  : error instanceof ReportHttpError && error.status === 503
    ? "報表服務或來源授權目前無法使用，請稍後重試或聯絡專案管理者。" : "報表讀取失敗，請重試。";

export function PurposeReportPage() {
  const [models, setModels] = useState<ReportModel[]>([]);
  const [localPreview, setLocalPreview] = useState(false);
  const [modelsOffset, setModelsOffset] = useState(0);
  const [modelsNextOffset, setModelsNextOffset] = useState<number|null>(null);
  const [modelsBusy, setModelsBusy] = useState(true);
  const [modelsError, setModelsError] = useState("");
  const [modelRetry, setModelRetry] = useState(0);
  const [model, setModel] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number|null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRetry, setHistoryRetry] = useState(0);
  const [record, setRecord] = useState("");
  const [report, setReport] = useState<ValidationReport|null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const [detailLimit, setDetailLimit] = useState(100);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [downloadStatus, setDownloadStatus] = useState("");
  const generation = useRef(0);
  const modelGeneration = useRef(0);
  const download = useRef<AbortController|null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setModelsBusy(true); setModelsError("");
    setLocalPreview(false);
    validationReportClient.getModels(modelsOffset, controller.signal).then(result => {
      if (!controller.signal.aborted) {
        setModels(previous => modelsOffset === 0 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.readyModelId === item.readyModelId))]);
        setModelsNextOffset(result.nextOffset);
        setLocalPreview(result.accessMode === "local-supervisor-preview");
      }
    }).catch(error => { if (!controller.signal.aborted) setModelsError(failure(error)); })
      .finally(() => { if (!controller.signal.aborted) setModelsBusy(false); });
    return () => controller.abort();
  }, [modelRetry, modelsOffset]);

  useEffect(() => {
    if (!model) return;
    const controller = new AbortController(), epoch = modelGeneration.current;
    setHistoryBusy(true); setHistoryError("");
    validationReportClient.getHistory(model, offset, controller.signal).then(result => {
      if (controller.signal.aborted || epoch !== modelGeneration.current) return;
      setHistory(previous => offset === 0 ? result.items : [...previous, ...result.items.filter(item => !previous.some(old => old.recordId === item.recordId))]);
      setNextOffset(result.nextOffset);
    }).catch(error => {
      if (!controller.signal.aborted && epoch === modelGeneration.current) setHistoryError(failure(error));
    }).finally(() => {
      if (!controller.signal.aborted && epoch === modelGeneration.current) setHistoryBusy(false);
    });
    return () => controller.abort();
  }, [model, offset, historyRetry]);

  useEffect(() => {
    if (!model || !record) return;
    const controller = new AbortController(), epoch = generation.current;
    setDetailBusy(true); setDetailError("");
    validationReportClient.getReport(model, record, controller.signal).then(value => {
      const selected = history.find(item => item.recordId === record);
      if (value.readyModelId !== model || value.recordId !== record || !selected || value.modelVersionId !== selected.modelVersionId) throw new Error("Report identity mismatch");
      if (!controller.signal.aborted && epoch === generation.current) setReport(value);
    }).catch(error => {
      if (!controller.signal.aborted && epoch === generation.current) setDetailError(failure(error));
    }).finally(() => {
      if (!controller.signal.aborted && epoch === generation.current) setDetailBusy(false);
    });
    return () => controller.abort();
  }, [model, record, detailRetry, history]);

  useEffect(() => () => { generation.current++; download.current?.abort(); }, []);

  function clearSelection() {
    generation.current++;
    download.current?.abort();
    download.current = null;
    setDownloadBusy(false); setDownloadError(""); setReport(null);
    setDownloadStatus("");
    setDetailBusy(false); setDetailError(""); setDetailLimit(100);
  }
  function selectModel(value: string) {
    modelGeneration.current++;
    clearSelection(); setModel(value); setRecord(""); setHistory([]);
    setOffset(0); setNextOffset(null); setHistoryError(""); setHistoryBusy(!!value);
  }
  function selectRecord(value: string) {
    clearSelection(); setRecord(value);
  }
  function cancelDownload() {
    download.current?.abort(); download.current = null;
    setDownloadBusy(false); setDownloadError(""); setDownloadStatus("已取消下載。");
  }
  async function downloadSelected(format: "csv" | "pdf") {
    if (!report || download.current) return;
    const controller = new AbortController(), epoch = generation.current;
    const selectedModel = model, selectedRecord = record;
    download.current = controller;
    setDownloadBusy(true); setDownloadError(""); setDownloadStatus(format.toUpperCase() + " 下載中…");
    try {
      const blob = await (format === "pdf" ? validationReportClient.downloadPdf : validationReportClient.downloadCsv)(
        selectedModel, selectedRecord, controller.signal);
      if (controller.signal.aborted || generation.current !== epoch || report.readyModelId !== selectedModel || report.recordId !== selectedRecord) return;
      const url = URL.createObjectURL(blob);
      try {
        const anchor = document.createElement("a");
        anchor.href = url; anchor.download = selectedRecord + "." + format;
        document.body.append(anchor);
        try { anchor.click(); } finally { anchor.remove(); }
      } finally { setTimeout(() => URL.revokeObjectURL(url), 30_000); }
      setDownloadStatus(format.toUpperCase() + " 已交給瀏覽器下載，請查看瀏覽器的下載紀錄。");
    } catch (error) {
      if (!controller.signal.aborted && generation.current === epoch) {
        setDownloadStatus("");
        setDownloadError(error instanceof ReportHttpError && error.status === 403
          ? "沒有此報表的存取權限，請聯絡專案管理者。"
          : "下載失敗，請再次按下載 " + format.toUpperCase() + " 重試。");
      }
    } finally {
      if (download.current === controller) download.current = null;
      if (!controller.signal.aborted && generation.current === epoch) setDownloadBusy(false);
    }
  }
  const inventory = report?.inventory;
  const inventoryUnknown = inventory?.observation === "not_run" ||
    (inventory?.observation === undefined && inventory?.expectedRenderable === null &&
     inventory.convertedRenderable === null && inventory.missing.length === 0 && inventory.excluded.length === 0);
  return <main className="purpose-report" data-prov="asbuilt">
    <header><div><p className="purpose-report-kicker">模型品質與可追溯性</p><h1>用途驗證報表</h1>
      <p>依驗證紀錄確認模型適用範圍；閱讀報表不會改變 3D 模型。</p></div><a href="#pipeline">返回模型資料</a></header>
    {localPreview && <aside className="purpose-report-access" aria-label="主管暫行驗證權限">
      <strong>主管預設驗證權限 · 僅本機</strong>
      <p>僅可閱讀及下載許良宇圖書館指定版本的驗證報表。這是暫行本機預覽，未驗證公司登入身份。</p>
      <p>版本 24e598ab-be3d-4dbb-a1aa-60b0ba610618 · 不含模型變更或 3D 操作權限。</p>
    </aside>}
    <section className="purpose-report-picker" aria-label="選擇驗證紀錄">
      {modelsBusy && <p role="status">正在載入模型清單…</p>}
      {modelsError && <p role="alert">{modelsError} <button onClick={() => setModelRetry(n=>n+1)}>重試模型清單</button></p>}
      {!modelsBusy && !modelsError && models.length === 0 && <p>尚無模型紀錄。</p>}
      {models.length > 0 && <label>模型與版本<select aria-label="模型與版本" value={model} onChange={e=>selectModel(e.target.value)}>
        <option value="">請選擇模型與版本</option>{models.map(item=><option key={item.readyModelId} value={item.readyModelId}>{item.sourceName} · {item.modelVersionId}</option>)}
      </select></label>}
      {modelsNextOffset !== null && <button disabled={modelsBusy} onClick={()=>setModelsOffset(modelsNextOffset)}>載入更多模型紀錄</button>}
      {historyBusy && <p role="status">正在載入驗證紀錄…</p>}
      {historyError && <p role="alert">{historyError} <button onClick={()=>setHistoryRetry(n=>n+1)}>重試報表清單</button></p>}
      {model && !historyBusy && !historyError && !history.length && <p>尚無驗證紀錄。請確認此版本已完成用途驗證。</p>}
      {history.length > 0 && <label>驗證紀錄<select aria-label="驗證紀錄" value={record} onChange={e=>selectRecord(e.target.value)}>
        <option value="">請選擇驗證紀錄</option>{history.map((item,index)=><option key={item.recordId} value={item.recordId}>紀錄 {index+1} · {item.validatedAt} · {item.sourceName} · {item.modelVersionId}</option>)}
      </select></label>}
      {nextOffset !== null && <button disabled={historyBusy} onClick={()=>setOffset(nextOffset)}>載入更多歷史紀錄</button>}
    </section>
    {detailBusy && <p role="status">正在載入報表…</p>}
    {detailError && <p role="alert">{detailError} <button onClick={()=>setDetailRetry(n=>n+1)}>重試報表</button></p>}
    {report && <article aria-label="用途驗證結果">
      <div className="purpose-report-title"><div><h2>{report.source.name}</h2><p>版本 {report.modelVersionId} · 驗證時間 {report.validatedAt}</p></div>
        <div role="group" aria-label="下載此驗證紀錄">
          <button disabled={downloadBusy} onClick={()=>void downloadSelected("pdf")}>下載 PDF</button>{" "}
          <button disabled={downloadBusy} onClick={()=>void downloadSelected("csv")}>下載 CSV</button>
        </div></div>
      {downloadStatus && <p role="status">{downloadStatus}</p>}
      {downloadBusy && <button onClick={cancelDownload}>取消下載</button>}
      {downloadError && <p role="alert">{downloadError}</p>}
      <div className="purpose-report-cards">{purposes.map(([key,label])=>{
        const evaluation = report.evaluations.find(item=>item.purpose===key);
        const outcome = evaluation?.outcome ?? "not_validated";
        return <section key={key} data-outcome={outcome}><h3>{label}</h3><strong>{outcomes[outcome] ?? "尚未驗證"}</strong>
          {evaluation?.limitations.map(text=><p key={text}>{text}</p>)}
          {outcome === "not_validated" && <p>尚無足夠驗證依據，不代表已通過。</p>}
          {outcome === "not_usable" && <p>此用途的必要檢查未通過，請檢閱驗證明細。</p>}</section>;
      })}</div>
      <section className="purpose-report-inventory"><h3>來源與轉換對照</h3><dl>
        <dt>預期可顯示構件</dt><dd>{report.inventory.expectedRenderable ?? "未取得"}</dd>
        <dt>已轉換構件</dt><dd>{report.inventory.convertedRenderable ?? "未取得"}</dd>
        <dt>缺漏構件</dt><dd>{inventoryUnknown ? "尚未盤點" : report.inventory.missing.length}</dd><dt>排除構件</dt><dd>{inventoryUnknown ? "尚未盤點" : report.inventory.excluded.length}</dd>
      </dl><p>用途結論依各自檢查判定，不以單一比例替代。</p></section>
      <details><summary>驗證明細與追溯資料</summary><dl>
        <dt>報表紀錄</dt><dd>{report.recordId}</dd><dt>轉換作業</dt><dd>{report.conversionJobId}</dd>
        <dt>轉換器版本</dt><dd>{report.converterVersion ?? "未取得版本資訊"}</dd><dt>驗證器版本</dt><dd>{report.validatorVersion}</dd>
        <dt>IFC SHA-256</dt><dd>{report.source.sha256}</dd><dt>USDC SHA-256</dt><dd>{report.artifacts.usdcSha256 ?? "未取得"}</dd>
        <dt>構件對照 SHA-256</dt><dd>{report.artifacts.mappingSha256 ?? "未取得"}</dd>
      </dl>
      {report.sourceValidation && <section><h4>來源單位、座標與構件類別</h4><dl>
        <dt>IFC 每單位公尺數</dt><dd>{report.sourceValidation.units.ifcLengthScaleM ?? "未取得"}</dd>
        <dt>USD 每單位公尺數</dt><dd>{report.sourceValidation.units.usdMetersPerUnit ?? "未取得"}</dd>
        <dt>向上軸</dt><dd>{report.sourceValidation.units.upAxis ?? "未取得"}</dd>
        <dt>世界邊界檢查構件</dt><dd>{report.sourceValidation.coordinateEvidence?.checkedCount ?? "尚未驗證"}</dd>
        <dt>最大偏差（公尺）</dt><dd>{report.sourceValidation.coordinateEvidence?.maxDeltaM ?? "未取得"}</dd>
        <dt>比對容差（公尺）</dt><dd>{report.sourceValidation.coordinateEvidence?.toleranceM ?? "未取得"}</dd>
      </dl><p>世界邊界比對不代表距離量測已通過；用途結論仍以上方保存結果為準。</p>
      <table><thead><tr><th>IFC 類別</th><th>預期構件</th><th>已轉換</th></tr></thead><tbody>
        {report.sourceValidation.byClass.map(row=><tr key={row.ifcType}><td>{row.ifcType}</td><td>{row.expected}</td><td>{row.converted ?? "未取得"}</td></tr>)}
      </tbody></table><h4>核准用途範圍摘要</h4>
      {report.sourceValidation.scopes.map(scope=><p key={scope.purpose}>{purposes.find(([id])=>id===scope.purpose)?.[1] ?? scope.purpose}：{scope.id} · 版本 {scope.version} · 必要構件 {scope.requiredGuidCount}</p>)}
      </section>}
      {report.purposes.map(item=><section key={item.purpose}><h4>{purposes.find(([id])=>id===item.purpose)?.[1]}</h4>
        <p>判準 {item.policy?.id ?? "未配置"} · 版本 {item.policy?.version ?? "未取得"}</p>
        <pre>{JSON.stringify(item.checks,null,2)}</pre></section>)}
      <h4>構件對照（GUID → 模型路徑）</h4>
      {report.correspondence === null ? <p>未取得構件對照</p> : <pre>{JSON.stringify(report.correspondence.slice(0,detailLimit),null,2)}</pre>}
      <h4>缺漏原因與排除範圍</h4>{inventoryUnknown ? <p>尚未盤點</p> : <pre>{JSON.stringify({missing:report.inventory.missing.slice(0,detailLimit),excluded:report.inventory.excluded.slice(0,detailLimit)},null,2)}</pre>}
      {Math.max(report.correspondence?.length ?? 0,report.inventory.missing.length,report.inventory.excluded.length)>detailLimit &&
        <button onClick={()=>setDetailLimit(n=>n+100)}>顯示更多構件明細</button>}
      </details>
    </article>}
  </main>;
}
