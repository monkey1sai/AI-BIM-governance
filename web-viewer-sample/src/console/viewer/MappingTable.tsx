// CH-H1 面板④「對構關係（IFC GUID ⇔ USD Prim Path）」：真資料，fetch element_mapping.json。
// 誠實鐵律：無 mapping_url（如 harness）顯誠實空狀態、不捏造；fake mapping 顯 fake banner、逐列標 fake，不冒充真實對映。
import { useEffect, useRef, useState } from "react";
import { type ElementMappingDocument, type ElementMappingItem, isFakeMappingDocument, isFakeMappingItem } from "../../types/mapping";

export interface MappingTableProps {
  mappingUrl?: string | null;
  selectedGuid?: string | null;
  onSelectGuid?: (guid: string) => void;
}

type LoadState = "idle" | "loading" | "ok" | "error" | "no_url";

export function MappingTable({ mappingUrl, selectedGuid, onSelectGuid }: MappingTableProps) {
  const [state, setState] = useState<LoadState>(mappingUrl ? "loading" : "no_url");
  const [doc, setDoc] = useState<ElementMappingDocument | null>(null);
  const [err, setErr] = useState<string>("");
  const reqRef = useRef(0);

  useEffect(() => {
    const id = ++reqRef.current;
    if (!mappingUrl) { setState("no_url"); setDoc(null); return; }
    setState("loading"); setErr("");
    fetch(mappingUrl, { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((j: ElementMappingDocument) => { if (id === reqRef.current) { setDoc(j); setState("ok"); } })
      .catch((e) => { if (id === reqRef.current) { setErr(e instanceof Error ? e.message : String(e)); setState("error"); } });
  }, [mappingUrl]);

  const items: ElementMappingItem[] = doc?.items ?? [];
  const fake = doc ? isFakeMappingDocument(doc) : false;

  return (
    <section className="gv-card gv-card--wide" data-testid="mapping-table">
      <header className="gv-card__title">
        <span>④ 對構關係 · IFC GUID ⇔ USD Prim Path</span>
        {fake && <span className="gv-badge gv-badge--fake" data-testid="mapping-fake">fake mapping</span>}
        {state === "ok" && <span className="gv-badge" data-testid="mapping-count">{items.length} rows</span>}
      </header>
      {state === "no_url" && <p className="gv-note" data-testid="mapping-empty">此 session 無 mapping_url（harness / 尚未轉檔產生 element_mapping.json）——誠實留空，不捏造對構。</p>}
      {state === "loading" && <p className="gv-note">載入 element_mapping.json…</p>}
      {state === "error" && <p className="gv-note gv-note--warn" data-testid="mapping-error">載入失敗：{err}</p>}
      {fake && <p className="gv-note gv-note--warn">偵測 fake / mock mapping，僅供 smoke test，不列入正式對構驗證。</p>}
      {state === "ok" && items.length > 0 && (
        <div className="gv-tablewrap">
          <table className="gv-table">
            <thead><tr><th>IFC GUID</th><th>IFC Type</th><th>IFC Name</th><th>USD Prim Path</th><th>Mapping Fidelity</th></tr></thead>
            <tbody>
              {items.slice(0, 60).map((it, i) => {
                const itemFake = isFakeMappingItem(it);
                const sel = selectedGuid && it.ifc_guid === selectedGuid;
                return (
                  <tr key={it.ifc_guid ?? i} className={sel ? "gv-row--sel" : ""} data-testid="mapping-row"
                      onClick={() => it.ifc_guid && onSelectGuid?.(it.ifc_guid)} style={{ cursor: it.ifc_guid ? "pointer" : "default" }}>
                    <td className="gv-mono">{it.ifc_guid ?? <span className="gv-warn">null</span>}</td>
                    <td>{it.ifc_class ?? ""}</td>
                    <td>{it.name ?? ""}</td>
                    <td className="gv-mono">{it.usd_prim_path ?? <span className="gv-warn">null（未對映）</span>}</td>
                    <td>{itemFake ? <span className="gv-warn">fake</span> : (it.mapping_method || (it.mapping_confidence != null ? `conf ${it.mapping_confidence}` : "guid_exact"))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {state === "ok" && items.length === 0 && <p className="gv-note" data-testid="mapping-zero">element_mapping.json 無 items。</p>}
    </section>
  );
}
