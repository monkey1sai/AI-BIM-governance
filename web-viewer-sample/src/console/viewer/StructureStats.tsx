// CH-H2/③：IFC 結構（依類別計數）—— 範本面板③的 MVP：由真實 element_mapping 依 ifc_class 分組計數
// （如 IfcWall 256 / IfcColumn 48…），點類別可篩選對構表。資料經 coordinator element-mapping proxy（守邊界）。
// 誠實：完整空間巢狀樹（IfcProject>Site>Building>Storey）需後端 hierarchy 端點，標 roadmap、不假造巢狀。
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

// 純展示（單元測試用）。
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
      <p className="gv-note">完整空間巢狀（Project&gt;Site&gt;Building&gt;Storey）⌛ roadmap（需後端 hierarchy）；以下為真實類別計數。</p>
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

export function StructureStats({ mappingUrl, selectedClass, onSelectClass }: {
  mappingUrl?: string | null;
  selectedClass?: string | null;
  onSelectClass?: (c: string | null) => void;
}) {
  const [state, setState] = useState<LoadState>(mappingUrl ? "loading" : "no_url");
  const [doc, setDoc] = useState<ElementMappingDocument | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    const id = ++reqRef.current;
    if (!mappingUrl) { setState("no_url"); setDoc(null); return; }
    setState("loading");
    fetch(mappingUrl, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: ElementMappingDocument) => { if (id === reqRef.current) { setDoc(j); setState("ok"); } })
      .catch(() => { if (id === reqRef.current) { setState("error"); } });
  }, [mappingUrl]);

  if (state === "no_url") return <section className="gv-card" data-testid="structure-stats"><header className="gv-card__title">③ IFC 結構</header><p className="gv-note" data-testid="struct-empty">無 mapping（harness / 尚未轉檔）。</p></section>;
  if (state === "loading") return <section className="gv-card" data-testid="structure-stats"><header className="gv-card__title">③ IFC 結構</header><p className="gv-note">載入結構…</p></section>;
  if (state === "error") return <section className="gv-card" data-testid="structure-stats"><header className="gv-card__title">③ IFC 結構</header><p className="gv-note gv-note--warn">結構載入失敗。</p></section>;

  const counts = classCountsFromDoc(doc);
  const total = doc?.items?.length ?? 0;
  const fake = doc ? isFakeMappingDocument(doc) : false;
  return (
    <>
      {fake && <p className="gv-note gv-note--warn">fake mapping：類別計數僅供 smoke。</p>}
      <StructureStatsView counts={counts} total={total} selectedClass={selectedClass} onSelectClass={onSelectClass} />
    </>
  );
}
