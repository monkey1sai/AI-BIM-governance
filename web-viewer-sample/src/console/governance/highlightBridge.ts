// web-viewer-sample/src/console/governance/highlightBridge.ts
// HighlightBridge：治理失敗構件 usd_prim_path → highlightPrimsRequest → 經注入的 sendMessage（既有
// _sendStreamMessage / AppStreamer.sendMessage）走 viewer WebRTC DataChannel 在 3D 標紅。
// 著色走 client 主動拉（client → DataChannel → Kit），不復活 2026-05-21 退役的 server-push highlight。
// 未對映 / DataChannel 未就緒誠實回拒（不捏造 prim、不假裝成功）。
import { buildHighlightPrimsRequest, severityToColor } from "../../clients/streamMessages";
import type { HighlightItem, StreamMessage } from "../../types/streamMessages";
import type { MappingCache } from "./mappingCache";

export interface FailedElement {
  ifc_guid: string;
  severity: string; // error / warning / ...
  label?: string;
  rule_code?: string;
}

export type HighlightResult =
  | { ok: true; primPath: string; requestId: string }
  | { ok: false; reason: "unmapped" | "datachannel_not_ready" };

// A2 F2⑥ 批次疊加：單一 highlightPrimsRequest 可帶多 items，Kit 端 _on_highlight_prims 會把全部
// prim 收進同一次 set_selected_prim_paths（聯集選取）。反之「逐筆各發一個 mode:"replace" request」
// 會每筆先 clear 前一筆（stage_management.py:406-411），多構件最終只剩最後一筆——批次疊加必須走
// 這個單一 request 入口。unmapped 誠實逐 GUID 回列（不捏造 prim、不虛報成功筆數）。
export type HighlightManyResult =
  | { ok: true; requestId: string; sent: { ifc_guid: string; primPath: string }[]; unmapped: string[] }
  | { ok: false; reason: "unmapped" | "datachannel_not_ready" };

// severityToColor 只特判 "error"/"warning"，其餘一律藍。治理 rule engine 可能吐 critical/high/medium/low
// 等其他標籤，先正規化成 severityToColor 認得的 error/warning（大小寫不敏感），其餘原樣透傳（→ 預設藍）。
// 不改 severityToColor 本身（共用於 mapping-verify 等既有路徑）。
export function normalizeSeverity(sev: string): string {
  const s = sev.toLowerCase();
  if (s === "critical" || s === "high" || s === "error") return "error";
  if (s === "medium" || s === "warning") return "warning";
  return sev;
}

export interface HighlightBridgeDeps {
  cache: MappingCache;
  sendMessage: (message: StreamMessage) => void;
  dataChannelReady: () => boolean;
}

export class HighlightBridge {
  constructor(private readonly deps: HighlightBridgeDeps) {}

  highlightFailed(failed: FailedElement): HighlightResult {
    if (!this.deps.dataChannelReady()) {
      return { ok: false, reason: "datachannel_not_ready" };
    }
    const primPath = this.deps.cache.primPathForGuid(failed.ifc_guid); // fake cache → null
    if (!primPath) {
      return { ok: false, reason: "unmapped" };
    }
    const item: HighlightItem = {
      prim_path: primPath,
      ifc_guid: failed.ifc_guid,
      color: severityToColor(normalizeSeverity(failed.severity)),
      label: failed.label || failed.rule_code || failed.ifc_guid,
      source: "governance_failed",
      issue_id: failed.rule_code ? `gov:${failed.rule_code}:${failed.ifc_guid}` : `gov:${failed.ifc_guid}`,
    };
    const requestId = `gov-highlight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.deps.sendMessage(buildHighlightPrimsRequest([item], true, requestId));
    return { ok: true, primPath, requestId };
  }

  // 批次疊加（A2 diff overlay）：全部可對映構件裝進「一個」highlightPrimsRequest（mode:"replace"）
  // → Kit 端一次 set_selected_prim_paths 聯集選取。per-item color 仍照 severity 對映寫入協定 payload
  //（error=紅 / warning=橘 / 其他=藍），但 Kit 現行 handler（applied_mode="selection"）不讀 color——
  // 色彩分組是否呈現由 Kit 端決定（p15），此處不虛報。focusFirst=false：批次疊加不搶相機焦點
  //（Kit 現行 handler 亦未讀 focus_first，值僅協定紀錄）。
  highlightMany(failedList: FailedElement[]): HighlightManyResult {
    if (!this.deps.dataChannelReady()) {
      return { ok: false, reason: "datachannel_not_ready" };
    }
    const items: HighlightItem[] = [];
    const sent: { ifc_guid: string; primPath: string }[] = [];
    const unmapped: string[] = [];
    for (const failed of failedList) {
      const primPath = this.deps.cache.primPathForGuid(failed.ifc_guid); // fake cache → null（誠實 unmapped）
      if (!primPath) {
        unmapped.push(failed.ifc_guid);
        continue;
      }
      items.push({
        prim_path: primPath,
        ifc_guid: failed.ifc_guid,
        color: severityToColor(normalizeSeverity(failed.severity)),
        label: failed.label || failed.rule_code || failed.ifc_guid,
        source: "governance_failed",
        issue_id: failed.rule_code ? `gov:${failed.rule_code}:${failed.ifc_guid}` : `gov:${failed.ifc_guid}`,
      });
      sent.push({ ifc_guid: failed.ifc_guid, primPath });
    }
    if (items.length === 0) {
      // 全數未對映 → 不送空 request（誠實回拒，不假裝成功）。
      return { ok: false, reason: "unmapped" };
    }
    const requestId = `gov-highlight-batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.deps.sendMessage(buildHighlightPrimsRequest(items, false, requestId));
    return { ok: true, requestId, sent, unmapped };
  }
}
