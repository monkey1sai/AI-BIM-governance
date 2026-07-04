// web-viewer-sample/src/console/incomingHandoff.tsx
// 接收端 handoff 重驗（spec §4.2「接收端重驗鐵律」，硬性）：讀本軸的 incoming handoff，向頁面「已經
// 擁有」的權威資料重驗其攜帶的 id。verify predicate 只能查已在記憶體中的權威資料——不得多發新 fetch、
// 不得打新端點（N2/N4）。查無 → 誠實 not_found，絕不靜默 fallback 到別的紀錄，讓使用者手動重選。
import { useRef } from "react";
import { parseHandoff, type AxisKey, type CrossAxisHandoff } from "./handoff";
import { t } from "./i18n";

export type HandoffVerifyStatus = "none" | "verified" | "not_found" | "indeterminate" | "not_applicable";

export function useIncomingHandoff(
  selfAxis: AxisKey,
  // verify 回四態：true=命中權威資料（verified）；false=誠實查無（not_found）；"indeterminate"=目前無法判定
  // （權威資料被查詢窗上限截斷、或尚未載入）→ 誠實顯「未明」，不誤報 not_found（quality Important #4；§5.4）；
  // "not_applicable"=此 handoff 未帶「本軸會重驗的欄位」（sender 本來就不帶，例：SS→A1 只帶 session，但 A1 只
  // 重驗 minio_key）→ 中性「無欄位可查」，非查無，絕不顯示警示紅字（p5-critic honesty regression 修正）。此態與
  // indeterminate（資料截斷/載入中）語意分開：indeterminate=有欄位但暫無法判定；not_applicable=根本無欄位可查。
  verify: (h: CrossAxisHandoff) => boolean | "indeterminate" | "not_applicable",
  hash: string = typeof window !== "undefined" ? window.location.hash : "",
): { handoff: CrossAxisHandoff | null; status: HandoffVerifyStatus } {
  // quality Important #2：接收端重驗是「抵達時的一次性閘門」（spec §4.2），不是每次 render 的重算。一旦某個
  // handoff 對權威資料驗過 verified，就記住它的簽章（hash）；之後同一 handoff 的 render 即使 verify 因使用者
  // 手動導覽（如 M 頁 goUp/enterFolder 改變 folder）而回 false，也不得倒退成 not_found（假查無）。換 handoff
  // （hash 改變）則不繼承此 latch，維持誠實。useRef 必須無條件呼叫、在任何 early-return 之前（rules of hooks）。
  const verifiedSigRef = useRef<string | null>(null);
  const handoff = parseHandoff(hash);
  // 只回應目標路由是本頁的 handoff（hash 以 #<selfAxis> 開頭）；其餘（含無 handoff）一律 status="none"。
  if (!handoff || !hash.startsWith(`#${selfAxis}`)) return { handoff: null, status: "none" };
  const result = verify(handoff);
  if (result === true) verifiedSigRef.current = hash;
  const latched = verifiedSigRef.current === hash; // 本 handoff 曾驗過 → 不因後續 render 倒退
  const status: HandoffVerifyStatus =
    result === true || latched
      ? "verified"
      : result === "indeterminate"
        ? "indeterminate"
        : result === "not_applicable"
          ? "not_applicable"
          : "not_found";
  return { handoff, status };
}

function handoffIdText(h: CrossAxisHandoff): string {
  return h.session ?? h.minio_key ?? h.job_id ?? h.conversion_id ?? h.rule_run_id ?? h.prefix ?? "";
}

export function IncomingHandoffBanner({ testId, handoff, status }: { testId: string; handoff: CrossAxisHandoff | null; status: HandoffVerifyStatus }) {
  if (!handoff || status === "none") return null;
  const id = handoffIdText(handoff);
  // indeterminate（權威資料未完整載入或超出查詢窗）與 not_applicable（此 handoff 未帶本軸會重驗的欄位）
  // 都是中性態、非警示：不掛 ec-warn-note，也不宣稱已重驗或查無。只有 not_found（真的查過、真的沒有）才警示紅字。
  const text =
    status === "verified"
      ? t(`已接收來自 ${handoff.source} 的 ${id}（已向權威端點重驗）`, `Received ${id} from ${handoff.source} (re-verified against the authoritative endpoint)`)
      : status === "indeterminate"
        ? t(`來自 ${handoff.source} 的 ${id} 目前無法重驗（權威資料未完整載入或超出查詢窗），請重新整理後再確認`, `${id} from ${handoff.source} cannot be re-verified right now (authoritative data is incomplete or beyond the query window); refresh and check again`)
        : status === "not_applicable"
          ? t(`已從 ${handoff.source} 跨頁抵達；此連結未帶本頁可重驗的識別碼（無需重驗）`, `Arrived via a cross-link from ${handoff.source}; it carries no id this page re-verifies (nothing to re-verify)`)
          : t(`來自 ${handoff.source} 的 ${id} 在權威資料中查無，請手動重選（未靜默 fallback）`, `${id} from ${handoff.source} was not found in authoritative data; please reselect (no silent fallback)`);
  return (
    <div className={`ec-note ${status === "not_found" ? "ec-warn-note" : ""}`} data-testid={testId} data-handoff-status={status} data-handoff-source={handoff.source}>
      {text}
    </div>
  );
}
