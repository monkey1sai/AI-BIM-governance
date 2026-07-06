// web-viewer-sample/src/console/modelData/conversionShared.tsx
// MD 三頁合一（spec §6）：自 pages.tsx 抽出的轉檔共用件（原文搬移＋export，唯一真相源）。
import { t } from "../i18n";
import { Field } from "../components";
import type { Prov } from "../data";
import { narrowConversionStatus, type ConversionLifecycleStatus, type ConversionQualityMetricsResponse, type MinioObject } from "../coordinatorClient";

export function LifecycleStrip({ steps, statuses }: { steps: string[]; statuses?: ("done" | "current" | "future")[] }) {
  const cls = (i: number) => {
    const st = statuses?.[i];
    if (st === "done") return "done";
    if (st === "current") return "active";
    if (st === "future") return "";
    return i === 0 ? "active" : "";
  };
  return (
    <div className="ec-flow" style={{ margin: "8px 0 12px" }}>
      {steps.map((s, i) => (
        <span key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span className={`ec-flow-step ${cls(i)}`}><span className="ec-flow-n">{i + 1}</span>{s}</span>
          {i < steps.length - 1 && <span className="ec-flow-arrow">→</span>}
        </span>
      ))}
    </div>
  );
}

function pct(r?: number | null): string {
  if (typeof r !== "number" || !Number.isFinite(r)) return t("未取得", "not available");
  const p = r * 100;
  // 誠實鐵律「不得承諾 100% lossless」：ratio<1 卻四捨五入到 100.00 時下修顯 99.99%，
  // 不讓非滿覆蓋謊報成 100%（真實 ratio 仍由相鄰 mapped/unmapped 數與 coverage_status 揭露）。
  if (r < 1 && p.toFixed(2) === "100.00") return "99.99%";
  return `${p.toFixed(2)}%`;
}
export function CoverageDrawer({ state }: { state: ConversionQualityMetricsResponse | { error: string } | "loading" | undefined }) {
  if (state === "loading" || state === undefined) return <p className="ec-note">{t("讀取 coverage…", "Loading coverage…")}</p>;
  if ("error" in state) return <p className="ec-warn-note">{state.error}</p>;
  const s = state.quality_metrics_summary;
  if (!s) return <p className="ec-note">{t("未取得品質遙測（後端未提供 quality_metrics）。", "Quality telemetry not available (backend did not provide quality_metrics).")}</p>;
  // 誠實鐵律：materialization_strategy=usd_stage_enumeration 下 coverage_ratio 為自我參照——
  // source_ifc_entity_count 與 mapped_count 同源於同一次 USD stage prim 枚舉（adapter 端
  // source_count = len(mapping_items) = mapped_count），數學上結構性恆等於 1.0，意義是「枚舉到的
  // 都對映上」，並非對 IFC 原始 entity 全量的 lossless 覆蓋率。標出此語意，避免 100% 被誤讀成零遺漏。
  const usdEnumSelfRef = s.materialization_strategy === "usd_stage_enumeration";
  return (
    <>
      <Field k="coverage" v={`${pct(s.coverage_ratio)}${s.coverage_status ? ` · ${s.coverage_status}` : ""}`} prov="artifact" />
      <Field k="mapped / unmapped" v={`${s.mapped_count ?? t("未取得", "not available")} / ${s.unmapped_count ?? t("未取得", "not available")}`} prov="artifact" />
      <Field k={usdEnumSelfRef ? t("source（USD 枚舉 prim 數）", "source (count of enumerated USD prims)") : "source IFC entity"} v={String(s.source_ifc_entity_count ?? t("未取得", "not available"))} prov="artifact" />
      <Field k="materialization" v={s.materialization_strategy ?? t("未取得", "not available")} prov="artifact" />
      {/* spec §4.4 line 76 明列必顯欄：轉檔耗時秒數（後端 quality_metrics 既有，review.ts:19 / types.ts:79
          已型別化、buildQualityMetricsSummary 已萃取）。缺值誠實顯「未取得」，不捏值。 */}
      <Field k={t("conversion 耗時(s)", "conversion duration (s)")} v={typeof s.conversion_duration_seconds === "number" ? String(s.conversion_duration_seconds) : t("未取得", "not available")} prov="artifact" />
      <Field k={t("usdc 輸出", "usdc output")} v={state.usdc_url ?? t("未取得", "not available")} prov="artifact" />
      <Field k="mapping_url" v={state.mapping_url ?? t("未取得", "not available")} prov="artifact" />
      <Field k={t("property / relationship / attribute 三項", "property / relationship / attribute (three breakdowns)")} v={t("後端未提供（以 coverage_ratio 為準；三項拆分為 follow-up）", "Not provided by the backend (coverage_ratio is authoritative; the three-way breakdown is a follow-up)")} prov="p1" />
      {usdEnumSelfRef && (
        <p className="ec-warn-note" data-testid="conv-coverage-selfref-note">
          {t("⚠ coverage 基準為 USD stage 枚舉：source 為枚舉 prim 數、與 mapped 同源，此 % 是「枚舉到的都對映上」的自我比對，非對 IFC 原始 entity 全量的 lossless 覆蓋率。真 IFC 分母為 follow-up（M2-b）。", "⚠ Coverage is based on USD stage enumeration: source is the count of enumerated prims and shares the same origin as mapped, so this % is a self-comparison of \"everything enumerated got mapped\", not lossless coverage over the full set of original IFC entities. A real IFC denominator is a follow-up (M2-b).")}
        </p>
      )}
    </>
  );
}

// 轉檔 Ledger status → 中文顯示（誠實鐵律：禁自造 Prov 值；用既有 prov 配色）
export const LEDGER_STATUS_LABEL: Record<string, string> = {
  detected: "已偵測", queued: "排隊", converting: "轉檔中", ready: "完成", failed: "失敗",
};
export const LEDGER_STATUS_PROV: Record<string, Prov> = {
  detected: "artifact", queued: "artifact", converting: "artifact", ready: "asbuilt", failed: "p1",
};

// ifc-ready-api-field-redesign：jobs 表 lifecycle chip 中文標籤。重用既有 LEDGER_STATUS_LABEL
// （同一 lifecycle→中文 字典，避免第二份漂移）；null/undefined/未知值誠實退 "—"。
export function lifecycleLabel(s: ConversionLifecycleStatus | null | undefined): string {
  return s ? (LEDGER_STATUS_LABEL[s] ?? "—") : "—";
}

// ledger chip 狀態映射（與後端 ledgerChipStatus.ts 同義；前端內聯避免跨 monorepo tsconfig boundary）。
// records 來自 getConversionRecords()；無紀錄 → 'untracked'（顯「未轉（無 ledger 紀錄）」），不臆測。
// §3.4 auto-enroll 後既有檔多已自動觸發落 ledger queued，untracked 僅剩真正無紀錄者（首輪前/watcher 關）。
// 命中 → 後端 ConversionRecord.status 是寬 wire string（enum 演進 / 資料遷移殘留可能送非預期值），
// 故與 confirmTrigger 同樣先過 narrowConversionStatus()：非法值退 'unknown'（MINIO_CHIP_LABEL 有對應
// 標籤），不讓原始 wire 字串經 chip render 的 `?? st` fallback 外洩（誠實鐵律：不洩漏 wire 字串）。
//
// quality finding Important #1：getConversionRecords 有 limit（後端 parseListLimit 上限 100）。當 ledger
// 紀錄數超出回傳窗（count > items.length，截斷）或 records 載入失敗（coordinator 離線/502/timeout）時，
// 超窗/未載入的物件在 records 中查無 key——這是「可能有紀錄但前端看不到」，不可靜默當『未轉』（違反
// AC-chip『無紀錄才標未轉、不臆測』；誠實鐵律：records 載入失敗不得誤顯未轉）。故 miss 且 recordsIncomplete
// 時退 'indeterminate'（顯『狀態未明』），誠實揭露不確定來源。
export function ledgerChipStatus(
  idempotencyKey: string,
  records: ReadonlyArray<{ idempotency_key: string; status: string }>,
  recordsIncomplete: boolean, // 截斷（超查詢上限）或載入失敗——兩者皆「可能有紀錄但看不到」
): string {
  const hit = records.find((r) => r.idempotency_key === idempotencyKey);
  if (hit) return narrowConversionStatus(hit.status) ?? "unknown";
  // 查無紀錄：records 不完整（截斷／載入失敗）時誠實顯『狀態未明』；完整載入且查無才是真『未轉』。
  return recordsIncomplete ? "indeterminate" : "untracked";
}

// chip 狀態本地化標籤（無紀錄＝untracked → 未轉；其餘對應 ledger status enum）。
// 鍵集合對齊 spec AC-chip（design line 168）列舉的 7 個 chip 狀態，確保後端送任一列舉值都有本地化
// 標籤、不會 fallback 顯原始 wire 字串（誠實鐵律）。
export const MINIO_CHIP_LABEL: Record<string, string> = {
  detected: t("已偵測", "detected"),
  queued: t("排隊", "queued"),
  converting: t("轉檔中", "converting"),
  ready: t("完成", "ready"),
  failed: t("失敗", "failed"),
  untracked: t("未轉（無 ledger 紀錄）", "not converted (no ledger record)"),
  // not_queued＝spec AC-chip『未進佇列』。誠實註記：現行後端 ConversionLedgerStatus 只 5 值
  // （detected/queued/converting/ready/failed，conversionLedger.ts:11），不產生 not_queued——
  // 「偵測到未進佇列」目前由 detected 涵蓋；此 key 為 spec AC-chip 完整性保留。若後端日後細分出
  // not_queued，narrowConversionStatus 的 CONVERSION_LEDGER_STATUSES 須同步加入；未加入時 ledgerChipStatus
  // 的 `?? "unknown"` 仍誠實退 unknown（顯下方『未知狀態』、不洩漏 wire 字串）。
  not_queued: t("未進佇列", "not queued"),
  unknown: t("未知狀態", "unknown"), // narrowConversionStatus 退回值：後端送非預期 status 時誠實顯未知
  // records 不完整（截斷超查詢上限／載入失敗）且查無 key 時的誠實退路（≠『未轉』，避免靜默誤報）。
  indeterminate: t("狀態未明（紀錄不完整或載入失敗）", "indeterminate (records incomplete or unavailable)"),
};

export function roleLabel(role: MinioObject["role"]): string {
  if (role === "source_ifc") return t("來源 IFC", "Source IFC");
  if (role === "parsed_usdc") return t("已轉 USDC", "Converted USDC");
  return t("其他", "Other");
}

export function roleClass(role: MinioObject["role"]): string {
  if (role === "source_ifc") return "ec-prov artifact"; // cyan/artifact
  if (role === "parsed_usdc") return "ec-prov asbuilt"; // built
  return "ec-prov";
}
