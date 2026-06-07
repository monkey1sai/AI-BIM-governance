// CH-H2 前端：範本面板②「IFC 語意（Pset/Type/Property）」+ ⑥「空間關係」。
// 點構件 → 經 coordinator :8004 /api/governance/elements/for-session/:sessionId/:guid（coordinator resolve
// host IFC 路徑後 forward governance-service ifcopenshell 萃取）取真實 Pset/Quantity/空間鏈。
// 誠實鐵律：⑤幾何 + 分類碼無 pipeline 來源 → 顯 roadmap/N/A（端點回 null），不捏造；無選取/載入/錯誤皆誠實表態。
import { useEffect, useRef, useState } from "react";
import { coordinatorClient } from "../coordinatorClient";

export interface ElementSemantics {
  ifc_guid?: string | null;
  ifc_type?: string | null;
  ifc_name?: string | null;
  predefined_type?: string | null;
  object_type?: string | null;
  tag?: string | null;
  psets?: Record<string, Record<string, unknown>>;
  spatial?: Array<{ ifc_type?: string | null; name?: string | null; global_id?: string | null }>;
  classification?: unknown;
  geometry?: unknown;
  roadmap?: string[];
}

const DASH = "—";

// 純展示（便於單元測試，不依賴 fetch）。
export function IfcSemanticView({ data }: { data: ElementSemantics }) {
  const psets = data.psets ?? {};
  const psetNames = Object.keys(psets);
  const spatial = data.spatial ?? [];
  const attrs: [string, string][] = [
    ["IFC Type", data.ifc_type || DASH],
    ["IFC Name", data.ifc_name || DASH],
    ["GlobalId", data.ifc_guid || DASH],
    ["PredefinedType", data.predefined_type || DASH],
    ["ObjectType", data.object_type || DASH],
    ["Tag", data.tag || DASH],
  ];
  return (
    <div data-testid="ifc-semantic-view">
      <section className="gv-card" data-testid="sem-attrs">
        <header className="gv-card__title">② 檢視 IFC 語意（Type / Property）</header>
        <table className="gv-kv"><tbody>
          {attrs.map(([k, v]) => (
            <tr key={k}><td className="gv-kv__k">{k}</td><td className="gv-kv__v gv-mono" data-testid={`sem-${k.toLowerCase().replace(/\s/g, "")}`}>{v}</td></tr>
          ))}
        </tbody></table>
      </section>

      {psetNames.length > 0 && (
        <section className="gv-card" data-testid="sem-psets">
          <header className="gv-card__title">Pset / Quantity（{psetNames.length}）</header>
          {psetNames.map((pn) => (
            <div key={pn} className="gv-pset" data-testid="sem-pset">
              <div className="gv-pset__name">{pn}</div>
              <table className="gv-kv"><tbody>
                {Object.entries(psets[pn] ?? {}).map(([prop, val]) => (
                  <tr key={prop}><td className="gv-kv__k">{prop}</td><td className="gv-kv__v">{val == null ? DASH : String(val)}</td></tr>
                ))}
              </tbody></table>
            </div>
          ))}
        </section>
      )}

      <section className="gv-card" data-testid="sem-spatial">
        <header className="gv-card__title">⑥ 空間關係（Spatial）</header>
        {spatial.length > 0 ? (
          <ul className="gv-layers">
            {spatial.map((s, i) => (
              <li key={s.global_id ?? i}><span className="gv-mono">{s.ifc_type}</span> {s.name || DASH}</li>
            ))}
          </ul>
        ) : <p className="gv-note">無空間容納關係（或未指派）。</p>}
      </section>

      {/* 誠實 roadmap：⑤幾何 + 分類碼無來源 → 不捏造 */}
      <section className="gv-card" data-testid="sem-roadmap">
        <header className="gv-card__title">⑤ 幾何 / 分類碼</header>
        <p className="gv-note gv-note--warn">
          ⌛ roadmap：Bounding Box / 體積 / 材質、分類碼（MasterFormat / OmniClass / Uniformat）目前 pipeline 無來源，
          誠實標 N/A、不捏造。
        </p>
      </section>
    </div>
  );
}

type State = "no_sel" | "loading" | "ok" | "error" | "not_found";

export interface IfcSemanticPanelProps {
  sessionId?: string | null;
  selectedGuid?: string | null;
}

export function IfcSemanticPanel({ sessionId, selectedGuid }: IfcSemanticPanelProps) {
  const [state, setState] = useState<State>("no_sel");
  const [data, setData] = useState<ElementSemantics | null>(null);
  const [err, setErr] = useState<string>("");
  const reqRef = useRef(0);

  useEffect(() => {
    const id = ++reqRef.current;
    if (!sessionId || !selectedGuid) { setState("no_sel"); setData(null); return; }
    setState("loading"); setErr("");
    const url = `${coordinatorClient.base}/api/governance/elements/for-session/${encodeURIComponent(sessionId)}/${encodeURIComponent(selectedGuid)}`;
    fetch(url, { headers: { Accept: "application/json" } })
      .then(async (r) => {
        if (r.status === 404) { if (id === reqRef.current) { setState("not_found"); } return null; }
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return r.json();
      })
      .then((j) => { if (j && id === reqRef.current) { setData(j); setState("ok"); } })
      .catch((e) => { if (id === reqRef.current) { setErr(e instanceof Error ? e.message : String(e)); setState("error"); } });
  }, [sessionId, selectedGuid]);

  return (
    <section data-testid="ifc-semantic-panel">
      {state === "no_sel" && <p className="gv-note" data-testid="sem-no-sel">點結構樹 / 對構表的構件以查看其 IFC 語意 + 空間關係（真實 ifcopenshell 萃取）。</p>}
      {state === "loading" && <p className="gv-note">載入語意…</p>}
      {state === "error" && <p className="gv-note gv-note--warn" data-testid="sem-error">語意查詢失敗：{err}</p>}
      {state === "not_found" && <p className="gv-note gv-note--warn" data-testid="sem-not-found">此 guid 在來源 IFC 查無對應構件。</p>}
      {state === "ok" && data && <IfcSemanticView data={data} />}
    </section>
  );
}
