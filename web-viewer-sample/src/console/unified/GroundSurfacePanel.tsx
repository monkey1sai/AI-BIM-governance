import { useEffect, useRef, useState } from "react";
import { type GroundCatalog, type GroundFace, type GroundPreview, type GroundSurfaceClient, type GroundVersion } from "./groundSurfaceClient";
import type { StageBindingResultMessage, StageBindingSelection } from "../../viewerCommandChannel/viewerEmbedProtocol";
import { controlField } from "./controlStyles";

export interface GroundSurfacePanelProps {
  sessionId: string; ready: boolean; selectedPaths: string[];
  sourceKey: string;
  stageBindingPending?: boolean;
  applyStageBinding?: (artifacts: StageBindingSelection[]) => Promise<StageBindingResultMessage>;
  onCompositionChange?: () => void; client?: GroundSurfaceClient;
}

/** Primitive picking only limits the catalog scope. An authored face is explicitly selected in the list. */
export function GroundSurfacePanel({ sessionId, sourceKey, ready, stageBindingPending = false, selectedPaths, applyStageBinding,
  onCompositionChange, client }: GroundSurfacePanelProps) {
  const component = selectedPaths.find(path => /^\/World\/Elements\/[^/]+\/[^/]+(?:\/|$)/.test(path))?.split("/").slice(0, 5).join("/") ?? "";
  const [catalog, setCatalog] = useState<GroundCatalog | null>(null);
  const [sourceSha, setSourceSha] = useState<string | null>(null);
  const [selected, setSelected] = useState<GroundFace[]>([]);
  const [region, setRegion] = useState("行人參考區域");
  const [preview, setPreview] = useState<GroundPreview | null>(null);
  const [revision, setRevision] = useState<string | null>(null);
  const [saved, setSaved] = useState<GroundVersion | null>(null);
  const [versionId, setVersionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("先在模型或模型結構選取一個構件，再讀取原面候選。");
  const generation = useRef(0), readyRef = useRef(ready), pending = useRef<object | null>(null), componentRef = useRef(component);
  const stagePendingRef = useRef(stageBindingPending);
  const bindingGuard = useRef<{ lost: boolean } | null>(null);
  const readinessWait = useRef<{ resolve: (ready: boolean) => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const settleReadinessWait = (readyNow: boolean) => {
    const wait = readinessWait.current;
    if (!wait) return;
    readinessWait.current = null; clearTimeout(wait.timer); wait.resolve(readyNow);
  };
  readyRef.current = ready;
  stagePendingRef.current = stageBindingPending;
  componentRef.current = component;
  useEffect(() => {
    generation.current += 1;
    settleReadinessWait(false); bindingGuard.current = null;
    pending.current = null;
    setCatalog(null); setSourceSha(null); setSelected([]); setPreview(null); setRevision(null); setSaved(null); setVersionId(""); setBusy(false);
    setMessage("選取範圍已更新；原面候選不會自動當成可行走地面。");
    return () => { generation.current += 1; settleReadinessWait(false); bindingGuard.current = null; };
  }, [sessionId, sourceKey]);
  useEffect(() => { setCatalog(null); }, [component]);
  useEffect(() => {
    // Only stage_mismatch is an expected consequence of this binding. A real
    // lease/media/channel loss invalidates it permanently, even after reconnect.
    if (!ready && !stageBindingPending && bindingGuard.current) bindingGuard.current.lost = true;
    if (readinessWait.current && (ready || !stageBindingPending || bindingGuard.current?.lost)) settleReadinessWait(ready && !bindingGuard.current?.lost);
    if (!ready && !pending.current) setRevision(null);
  }, [ready, stageBindingPending]);

  const run = async (work: (valid: () => boolean) => Promise<void>) => {
    if (pending.current) return;
    const current = generation.current;
    const valid = () => current === generation.current;
    const operation = {};
    pending.current = operation; setBusy(true);
    try { await work(valid); }
    catch (error) { if (valid()) { setRevision(null); setMessage(error instanceof Error ? error.message : "ground_request_failed"); } }
    finally {
      if (pending.current === operation) { pending.current = null; if (valid()) setBusy(false); }
    }
  };
  const load = (cursor?: string | null) => run(async valid => {
    if (!client) return;
    const result = await client.catalog(sessionId, component, cursor);
    if (!valid() || componentRef.current !== component) return;
    if (sourceSha && sourceSha !== result.model_usdc_sha256) {
      setSelected([]); setRevision(null); setPreview(null); setSaved(null);
    }
    setCatalog(result);
    setSourceSha(result.model_usdc_sha256);
    setMessage(`本頁檢視 ${result.inspected_faces} 面；${result.faces.length} 個向上候選。${result.complete ? "此範圍已讀到末頁。" : "尚有下一頁，目錄未完整。"} 向上不代表可行走。`);
  });
  const show = () => run(async valid => {
    if (!sourceSha || !applyStageBinding || !client) return;
    setRevision(null); setMessage("驗證來源與選面，準備預覽…");
    const result = await client.preview(sessionId, region, sourceSha, selected);
    if (!valid() || !readyRef.current) return;
    setPreview(result); onCompositionChange?.();
    const guard = { lost: false }; bindingGuard.current = guard;
    try {
      const outcome = await applyStageBinding([
        { artifact_id: result.primary_artifact_id, role: "primary", load_order: 0 },
        { artifact_id: result.preview.artifact_id, role: "secondary", load_order: 1 },
      ]);
      if (!valid()) return;
      if (outcome.status !== "applied" || !outcome.revision_id || !outcome.applied_secondary_layers?.includes(result.preview.artifact_id)) {
        setMessage(`預覽未確認：${outcome.reason ?? "exact_layer_readback_missing"}`); return;
      }
      if (guard.lost || !readyRef.current && !stagePendingRef.current) {
        setMessage("預覽回覆後 Viewer 已失去就緒狀態，請重新預覽核對。"); return;
      }
      if (!readyRef.current) {
        setMessage("Kit 已回覆此預覽；等待模型載入核對恢復…");
        const resumed = await new Promise<boolean>(resolve => {
          const wait = { resolve, timer: undefined as unknown as ReturnType<typeof setTimeout> };
          wait.timer = setTimeout(() => { if (readinessWait.current === wait) settleReadinessWait(false); }, 5_000);
          readinessWait.current = wait;
        });
        if (!valid()) return;
        if (!resumed || guard.lost || !readyRef.current) {
          setMessage("預覽未確認：模型載入核對未恢復，請重新預覽核對。"); return;
        }
      }
      setRevision(outcome.revision_id);
      setMessage("Kit 已確認此選取預覽。核對位置與高程後，才能按「確認選取並保存版本」。地面與有效流體仍未驗證。");
    } finally {
      if (bindingGuard.current === guard) bindingGuard.current = null;
    }
  });
  const confirm = () => run(async valid => {
    if (!preview || !revision || !client) return;
    const result = await client.confirm(sessionId, preview.preview.selection_id, revision);
    if (!valid()) return;
    const readback = await client.saved(sessionId, result.selection_id);
    if (!valid()) return;
    if (readback.selection_sha256 !== result.selection_sha256 || readback.selection_id !== result.selection_id) throw new Error("selection_readback_mismatch");
    setSaved(readback); setVersionId(readback.selection_id);
    setMessage("選取版本已保存並讀回。此記錄只表示明選原面；尚未完成地面／有效流體核對，也沒有重新求解。");
  });
  const restore = () => run(async valid => {
    if (!client) return;
    const result = await client.saved(sessionId, versionId.trim());
    if (!valid()) return;
    setSaved(result); setSourceSha(result.model_usdc_sha256); setSelected(result.faces); setRegion(result.region_name); setRevision(null);
    setMessage("已讀回保存版本；要在目前 Kit 顯示，請重新預覽並核對。");
  });
  const clear = () => run(async valid => {
    setRevision(null);
    if (preview && applyStageBinding) {
      onCompositionChange?.();
      const outcome = await applyStageBinding([{ artifact_id: preview.primary_artifact_id, role: "primary", load_order: 0 }]);
      if (!valid()) return;
      if (outcome.status !== "applied" || !outcome.revision_id || !outcome.applied_secondary_layers || outcome.applied_secondary_layers.length !== 0) {
        setMessage(`移除預覽未確認：${outcome.reason ?? "layer_cleanup_readback_missing"}`); return;
      }
    }
    setPreview(null); setMessage("預覽已移除；原模型與已保存版本保留。CFD 可從風環境面板重新顯示。");
  });
  const disabled = !ready || busy || !client;
  return <section data-testid="ground-surface-panel" style={{ display: "grid", gap: 8, fontSize: 11 }}>
    <p>明選原面作為行人取樣參考。預覽會暫時隱藏 CFD；既有結果不變。粉紅色僅為選取標記，顯示抬高 0.01 m，原高程保留。</p>
    <label>區域名稱<input data-testid="ground-region-name" style={controlField} value={region} disabled={busy}
      onChange={event => { setRegion(event.target.value); setRevision(null); setSaved(null); }} maxLength={80} /></label>
    <div style={{ overflowWrap: "anywhere" }}>構件：{component || "尚未選取"}</div>
    <button data-testid="ground-catalog-load" disabled={disabled || !component} onClick={() => void load()}>讀取原面候選</button>
    <div data-testid="ground-status" role="status" style={{ height: 96, overflow: "auto", overflowWrap: "anywhere" }}>{message}</div>
    <div style={{ height: 280, overflow: "auto", border: "1px solid var(--ab-border)", padding: 4 }} data-testid="ground-candidates">
      {(catalog?.faces ?? []).map(face => <div key={face.face_id} style={{ borderBottom: "1px solid var(--ab-border)", padding: "6px 0" }}>
        <label><input type="checkbox" data-testid={`ground-face-${face.face_id}`} data-face-index={face.polygon_face_index} data-mesh-path={face.mesh_prim_path} checked={selected.some(item => item.face_id === face.face_id)}
          disabled={busy || selected.length >= 100 && !selected.some(item => item.face_id === face.face_id)}
          onChange={event => { setRevision(null); setSaved(null); setSelected(event.target.checked ? [...selected, face] : selected.filter(item => item.face_id !== face.face_id)); }} />
          原面 {face.polygon_face_index} · {face.area_m2.toFixed(2)} m²</label>
        <div>Z {Math.min(...face.vertices_m.map(point => point[2])).toFixed(3)}–{Math.max(...face.vertices_m.map(point => point[2])).toFixed(3)} m · 法向 Z {face.normal[2].toFixed(3)}</div>
        <details><summary>原面來源與三個頂點</summary><div style={{ overflowWrap: "anywhere" }}>{face.ifc_type}／{face.ifc_guid}<br />{face.mesh_prim_path}<br />{face.vertices_m.map(point => `(${point.map(value => value.toFixed(4)).join(", ")}) m`).join("；")}<br />{face.subdivision_scheme}：原始控制三角面，非細分後外觀。<br />面身分 {face.face_id}</div></details>
      </div>)}
      {catalog && <div>本頁拒絕：{Object.entries(catalog.rejected_faces).map(([reason, count]) => `${reason} ${count}`).join("、") || "0"}；不支援 Mesh {catalog.rejected_meshes.length}
        {catalog.rejected_meshes.map(item => <div key={item.mesh_prim_path} style={{ overflowWrap: "anywhere" }}>{item.mesh_prim_path}：{item.reason}</div>)}</div>}
    </div>
    <button data-testid="ground-catalog-next" disabled={disabled || !catalog?.next_cursor} onClick={() => void load(catalog?.next_cursor)}>下一頁候選</button>
    <div>已明選 {selected.length}／100 面；向上、屋頂與地下表面均須人工核對。</div>
    <button data-testid="ground-preview" disabled={disabled || !applyStageBinding || selected.length === 0 || !region.trim()} onClick={() => void show()}>預覽明選原面</button>
    <button data-testid="ground-confirm" disabled={disabled || !revision || !preview} onClick={() => void confirm()}>確認選取並保存版本</button>
    <button data-testid="ground-preview-clear" disabled={disabled || !preview || !applyStageBinding} onClick={() => void clear()}>移除預覽，顯示原模型</button>
    <label>選取版本 ID<input data-testid="ground-version-id" style={controlField} value={versionId} disabled={busy} onChange={event => setVersionId(event.target.value)} /></label>
    <button data-testid="ground-version-load" disabled={disabled || !/^ground_[0-9a-f]{64}$/.test(versionId.trim())} onClick={() => void restore()}>讀回保存版本</button>
    <div data-testid="ground-saved-version" style={{ minHeight: 55, overflowWrap: "anywhere" }}>{saved ? `已保存版本 ${saved.selection_id}；地面未核對、未重新求解。` : "尚未保存選取版本。"}</div>
  </section>;
}
