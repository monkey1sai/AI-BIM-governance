// CH-H2/③：IFC 結構（範本面板③）。優先顯真實「空間巢狀樹」（IfcProject>Site>Building>Storey + 每節點類別計數，
// 經 coordinator spatial-tree for-session proxy）；無 session（harness）時退回由 element_mapping 派生的「依類別計數」。
// 資料一律經 coordinator :8004（守邊界）。誠實：缺資料顯誠實空狀態、不捏造巢狀。
import { useEffect, useRef, useState } from "react";
import { type ElementMappingDocument, isFakeMappingDocument } from "../../types/mapping";

export interface ClassCount { ifc_class: string; count: number }

export function classCountsFromDoc(doc: ElementMappingDocument | null): ClassCount[] {
  const items = doc?.items ?? [];
  const m = new Map<string, number>();
  for (const it of items) {
    const c = it.ifc_class || "(unknown)";
    m.set(c, (m.get(c) ?? 0) + 1);
  }
  return [...m.entries()].map(([ifc_class, count]) => ({ ifc_class, count })).sort((a, b) => b.count - a.count);
}

export interface SpatialNode {
  ifc_type?: string | null;
  name?: string | null;
  global_id?: string | null;
  type_counts?: Record<string, number>;
  children?: SpatialNode[];
}

// 純展示：遞迴空間巢狀樹（單元測試用）。
export function SpatialTreeView({ node, depth = 0 }: { node: SpatialNode; depth?: number }) {
  const counts = Object.entries(node.type_counts ?? {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="gv-tree" data-testid="struct-tree-node" style={{ marginLeft: depth * 12 }}>
      <div className="gv-tree__node">
        <span className="gv-mono">{node.ifc_type}</span> {node.name || ""}
        {counts.length > 0 && (
          <span className="gv-tree__counts">{counts.map(([t, n]) => `${t.replace(/^Ifc/, "")} ${n}`).join(" · ")}</span>
        )}
      </div>
      {(node.children ?? []).map((c, i) => <SpatialTreeView key={c.global_id ?? i} node={c} depth={depth + 1} />)}
    </div>
  );
}

// 純展示：依類別計數（fallback）。
export function StructureStatsView({ counts, total, selectedClass, onSelectClass }: {
  counts: ClassCount[];
  total: number;
  selectedClass?: string | null;
  onSelectClass?: (c: string | null) => void;
}) {
  return (
    <section className="gv-card" data-testid="structure-stats">
      <header className="gv-card__title">
        <span>③ IFC 結構（依類別）</span>
        <span className="gv-badge" data-testid="struct-total">{total} 構件</span>
      </header>
      <p className="gv-note">完整空間巢狀需真實 session；以下為類別計數。</p>
      <table className="gv-kv"><tbody>
        {counts.slice(0, 30).map((c) => (
          <tr key={c.ifc_class} className={selectedClass === c.ifc_class ? "gv-row--sel" : ""}
              data-testid="struct-row" style={{ cursor: onSelectClass ? "pointer" : "default" }}
              onClick={() => onSelectClass?.(selectedClass === c.ifc_class ? null : c.ifc_class)}>
            <td className="gv-kv__k">{c.ifc_class}</td>
            <td className="gv-kv__v gv-mono">{c.count}</td>
          </tr>
        ))}
      </tbody></table>
    </section>
  );
}

type LoadState = "idle" | "loading" | "ok" | "error" | "no_url";

export function StructureStats({ spatialUrl, mappingUrl }: { spatialUrl?: string | null; mappingUrl?: string | null }) {
  // 優先空間巢狀樹（真實 session）；無則退回 mapping 類別計數。
  const useTree = Boolean(spatialUrl);
  const url = spatialUrl || mappingUrl || null;
  const [state, setState] = useState<LoadState>(url ? "loading" : "no_url");
  const [tree, setTree] = useState<SpatialNode | null>(null);
  const [doc, setDoc] = useState<ElementMappingDocument | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const id = ++reqRef.current;
    if (!url) { setState("no_url"); setTree(null); setDoc(null); return; }
    setState("loading");
    fetch(url, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => {
        if (id !== reqRef.current) return;
        if (useTree) setTree(j?.tree ?? null);
        else setDoc(j as ElementMappingDocument);
        setState("ok");
      })
      .catch(() => { if (id === reqRef.current) setState("error"); });
  }, [url, useTree]);

  if (state === "no_url") return <section className="gv-card" data-testid="structure-stats"><header className="gv-card__title">③ IFC 結構</header><p className="gv-note" data-testid="struct-empty">無 mapping/session（harness / 尚未轉檔）。</p></section>;
  if (state === "loading") return <section className="gv-card" data-testid="structure-stats"><header className="gv-card__title">③ IFC 結構</header><p className="gv-note">載入結構…</p></section>;
  if (state === "error") return <section className="gv-card" data-testid="structure-stats"><header className="gv-card__title">③ IFC 結構</header><p className="gv-note gv-note--warn">結構載入失敗。</p></section>;

  if (useTree && tree) {
    return (
      <section className="gv-card" data-testid="structure-stats">
        <header className="gv-card__title">③ IFC 結構（空間巢狀）</header>
        <SpatialTreeView node={tree} />
      </section>
    );
  }
  // fallback：類別計數
  const counts = classCountsFromDoc(doc);
  const total = doc?.items?.length ?? 0;
  const fake = doc ? isFakeMappingDocument(doc) : false;
  return (
    <>
      {fake && <p className="gv-note gv-note--warn">fake mapping：類別計數僅供 smoke。</p>}
      <StructureStatsView counts={counts} total={total} />
    </>
  );
}
