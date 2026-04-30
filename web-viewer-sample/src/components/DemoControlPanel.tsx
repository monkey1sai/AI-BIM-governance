import type React from "react";
import type { DemoLogEntry } from "../types/demo";
import type { ElementMappingItem, ElementMappingSummary } from "../types/mapping";
import type { ReviewStreamConfig } from "../types/review";

interface DemoControlPanelProps {
    width: number;
    sessionId: string | null;
    reviewStatus: string;
    selectedAssetUrl: string | null;
    streamConfig: ReviewStreamConfig | null;
    mappingUrl: string | null;
    mappingStatus: string;
    mappingSummary: ElementMappingSummary | null;
    mappingItems: ElementMappingItem[];
    selectedMappingIndex: number;
    lastMappingVerification: string | null;
    mappingVerificationBlockedReason: string | null;
    outgoingMessages: DemoLogEntry[];
    incomingMessages: DemoLogEntry[];
    socketEvents: string[];
    onCreateOrLoadSession: () => void;
    onLoadBootstrap: () => void;
    onConnectSocket: () => void;
    onOpenStage: () => void;
    onLoadingState: () => void;
    onGetChildren: () => void;
    onHighlightWorld: () => void;
    onFocusWorld: () => void;
    onClearHighlight: () => void;
    onEmitCoordinatorHighlight: () => void;
    onCreateAnnotation: () => void;
    onLoadMapping: () => void;
    onSelectMappingIndex: (index: number) => void;
    onHighlightSelectedMapping: () => void;
    onFocusSelectedMapping: () => void;
}

const stepDefs: { num: string; name: string; href: string; active?: boolean }[] = [
    { num: "①", name: "上傳建模 (Upload)",  href: "http://127.0.0.1:8002" },
    { num: "②", name: "自動轉換 (Convert)", href: "http://127.0.0.1:8003" },
    { num: "③", name: "建立會議 (Meeting)", href: "http://127.0.0.1:8004" },
    { num: "④", name: "標記問題 (Mark)",    href: "#",                     active: true },
    { num: "⑤", name: "紀錄回寫 (Record)",  href: "http://127.0.0.1:8001" },
];

const sectionStyle: React.CSSProperties = {
    background: "var(--demo-bg-card)",
    border: "1px solid var(--demo-border)",
    borderRadius: "var(--demo-radius-lg)",
    padding: 14,
    marginBottom: 12,
    boxShadow: "0 1px 2px rgba(16,42,67,0.08)",
};

const primaryBtn: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    background: "var(--demo-brand)",
    color: "#fff",
    border: "1px solid var(--demo-brand)",
    borderRadius: "var(--demo-radius)",
    cursor: "pointer",
    fontWeight: 500,
    marginBottom: 4,
    textAlign: "left",
};

const secondaryBtn: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    background: "var(--demo-bg-elevated)",
    color: "var(--demo-text-primary)",
    border: "1px solid var(--demo-border-strong)",
    borderRadius: "var(--demo-radius)",
    cursor: "pointer",
    marginBottom: 4,
    textAlign: "left",
    fontSize: 12,
};

const captionStyle: React.CSSProperties = {
    display: "block",
    margin: "0 0 10px 4px",
    fontSize: 12,
    color: "var(--demo-text-secondary)",
};

export default function DemoControlPanel(props: DemoControlPanelProps) {
    const {
        width,
        sessionId,
        reviewStatus,
        selectedAssetUrl,
        streamConfig,
        mappingUrl,
        mappingStatus,
        mappingSummary,
        mappingItems,
        selectedMappingIndex,
        lastMappingVerification,
        mappingVerificationBlockedReason,
        outgoingMessages,
        incomingMessages,
        socketEvents,
        onCreateOrLoadSession,
        onLoadBootstrap,
        onConnectSocket,
        onOpenStage,
        onLoadingState,
        onGetChildren,
        onHighlightWorld,
        onFocusWorld,
        onClearHighlight,
        onEmitCoordinatorHighlight,
        onCreateAnnotation,
        onLoadMapping,
        onSelectMappingIndex,
        onHighlightSelectedMapping,
        onFocusSelectedMapping,
    } = props;

    const selectedMapping = mappingItems[selectedMappingIndex] || null;
    const disableMappingVerification = !selectedMapping || !!mappingVerificationBlockedReason;
    const modelKind = streamConfig?.model.status === "ready" ? "ok" : streamConfig ? "warn" : "idle";
    const reviewKind = inferKind(reviewStatus);

    return (
        <div
            className="demo-root"
            style={{
                width,
                background: "var(--demo-bg)",
                color: "var(--demo-text-primary)",
                borderLeft: "1px solid var(--demo-border)",
                display: "flex",
                flexDirection: "column",
                height: "100%",
                overflow: "hidden",
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: "12px 14px",
                    background: "var(--demo-bg-elevated)",
                    borderBottom: "1px solid var(--demo-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                }}
            >
                <span style={{ fontSize: 14, fontWeight: 600 }}>瀏覽器審查端 (Web Viewer)</span>
                <span style={{ fontSize: 12, color: "var(--demo-text-secondary)" }}>步驟 ④ / 5</span>
            </div>

            {/* Step bar */}
            <div
                style={{
                    display: "flex",
                    gap: 4,
                    padding: "8px 10px",
                    background: "var(--demo-bg-elevated)",
                    borderBottom: "1px solid var(--demo-border)",
                    overflowX: "auto",
                    flexShrink: 0,
                }}
            >
                {stepDefs.map((s) => (
                    <a
                        key={s.num}
                        href={s.href}
                        target={s.active ? undefined : "_blank"}
                        rel="noreferrer"
                        style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "6px 8px",
                            borderRadius: "var(--demo-radius)",
                            textDecoration: "none",
                            fontSize: 11,
                            color: s.active ? "var(--demo-text-primary)" : "var(--demo-text-muted)",
                            background: s.active ? "var(--demo-brand-soft)" : "transparent",
                            fontWeight: s.active ? 600 : 400,
                            whiteSpace: "nowrap",
                        }}
                    >
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: 22,
                                height: 22,
                                borderRadius: "50%",
                                background: s.active ? "var(--demo-brand)" : "var(--demo-bg-card)",
                                color: s.active ? "#fff" : "var(--demo-text-muted)",
                                border: "1px solid var(--demo-border)",
                                fontSize: 11,
                            }}
                        >
                            {s.num}
                        </span>
                        {s.name}
                    </a>
                ))}
            </div>

            <div style={{ padding: 10, fontSize: 13, overflow: "auto", flex: 1 }}>
                {/* Status summary card */}
                <div style={sectionStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                        <strong style={{ fontSize: 14 }}>本場審查會議</strong>
                        <span className={`demo-status demo-status--${reviewKind}`}>{shortLabel(reviewKind)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--demo-text-secondary)", marginBottom: 6 }}>
                        會議識別碼 (Session id)：<span style={{ color: "var(--demo-text-primary)", fontFamily: "var(--demo-font-mono)" }}>{sessionId || "尚未建立"}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--demo-text-secondary)", marginBottom: 6 }}>
                        可審查模型：<span className={`demo-status demo-status--${modelKind}`} style={{ marginLeft: 4 }}>
                            {modelKind === "ok" ? "已就緒" : streamConfig ? "尚未就緒" : "查詢中"}
                        </span>
                    </div>
                    <div style={{ fontSize: 11, color: "var(--demo-text-muted)", wordBreak: "break-all" }}>
                        {selectedAssetUrl || reviewStatus}
                    </div>
                </div>

                {/* Demo actions: business language */}
                <div style={sectionStyle}>
                    <strong style={{ fontSize: 14 }}>示範操作 (Demo actions)</strong>

                    <div style={{ marginTop: 10 }}>
                        <button type="button" style={primaryBtn} onClick={onCreateOrLoadSession}>
                            建立或載入審查會議
                        </button>
                        <span style={captionStyle}>↳ 連到審查協調服務、取得本場會議的連線資訊</span>

                        <button type="button" style={primaryBtn} onClick={onConnectSocket}>
                            連線即時頻道
                        </button>
                        <span style={captionStyle}>↳ 用於與其他審查人員同步操作 (Socket.IO)</span>

                        <button type="button" style={primaryBtn} onClick={onOpenStage}>
                            載入可審查 3D 模型
                        </button>
                        <span style={captionStyle}>↳ 把已轉換好的 3D 模型載入到串流畫面 (Open stage)</span>

                        <button type="button" style={primaryBtn} onClick={onHighlightWorld}>
                            標示示範問題
                        </button>
                        <span style={captionStyle}>↳ 在 3D 模型上把問題位置高亮給審查人員看</span>

                        <button type="button" style={primaryBtn} onClick={onCreateAnnotation}>
                            建立審查標註
                        </button>
                        <span style={captionStyle}>↳ 把審查意見寫回主資料庫 (Step ⑤)</span>

                        <button type="button" style={secondaryBtn} onClick={onClearHighlight}>
                            清除高亮
                        </button>
                    </div>
                </div>

                {/* Mapping verification simplified */}
                <div style={sectionStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                        <strong style={{ fontSize: 14 }}>元件對照表 (Element mapping)</strong>
                        <span className={`demo-status demo-status--${mappingStatus.includes("已載入") || mappingStatus.includes("成功") ? "ok" : mappingUrl ? "warn" : "idle"}`}>
                            {mappingStatus.slice(0, 14) || "尚未載入"}
                        </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--demo-text-secondary)", marginBottom: 8 }}>
                        對照表把 BIM 建築元件對應到 3D 模型內的位置，確保「點到問題」會精準高亮對應元件。
                    </div>
                    {mappingSummary && (
                        <div style={{ fontSize: 12, color: "var(--demo-text-muted)", marginBottom: 8 }}>
                            已對應 {mappingSummary.mapped_count ?? 0} 個元件，未對應 IFC {mappingSummary.unmapped_ifc_count ?? 0} / USD {mappingSummary.unmapped_usd_count ?? 0}
                        </div>
                    )}
                    {mappingVerificationBlockedReason && (
                        <div
                            style={{
                                padding: 8,
                                marginBottom: 8,
                                borderLeft: "3px solid var(--demo-status-warn)",
                                background: "var(--demo-status-warn-soft)",
                                color: "var(--demo-text-secondary)",
                                fontSize: 12,
                            }}
                        >
                            {mappingVerificationBlockedReason}
                        </div>
                    )}
                    <button type="button" style={secondaryBtn} onClick={onLoadMapping} disabled={!mappingUrl}>
                        載入元件對照表
                    </button>
                    {mappingItems.length > 0 && (
                        <select
                            value={selectedMappingIndex}
                            onChange={(event) => onSelectMappingIndex(Number(event.target.value))}
                            style={{
                                width: "100%",
                                marginTop: 6,
                                padding: 6,
                                background: "var(--demo-bg-elevated)",
                                border: "1px solid var(--demo-border)",
                                borderRadius: "var(--demo-radius)",
                                fontSize: 12,
                                color: "var(--demo-text-primary)",
                            }}
                        >
                            {mappingItems.map((item, index) => (
                                <option key={`${item.ifc_guid || "no-guid"}-${item.usd_prim_path || "no-path"}-${index}`} value={index}>
                                    {mappingOptionLabel(item, index)}
                                </option>
                            ))}
                        </select>
                    )}
                    <button type="button" style={secondaryBtn} onClick={onHighlightSelectedMapping} disabled={disableMappingVerification}>
                        用選取元件試標問題
                    </button>
                    <button type="button" style={secondaryBtn} onClick={onFocusSelectedMapping} disabled={disableMappingVerification}>
                        用選取元件試聚焦
                    </button>
                    {lastMappingVerification && (
                        <div style={{ marginTop: 6, fontSize: 11, color: "var(--demo-text-muted)" }}>
                            最近驗證：{lastMappingVerification}
                        </div>
                    )}
                </div>

                {/* Tech details */}
                <details style={{ ...sectionStyle, padding: "8px 12px", background: "var(--demo-bg-elevated)" }}>
                    <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--demo-text-secondary)" }}>
                        ▸ 展開技術細節 (Show technical details)
                    </summary>
                    <div style={{ marginTop: 10 }}>
                        <button type="button" style={secondaryBtn} onClick={onLoadBootstrap}>
                            GET review-bootstrap
                        </button>
                        <button type="button" style={secondaryBtn} onClick={onLoadingState}>
                            DataChannel: loadingStateQuery
                        </button>
                        <button type="button" style={secondaryBtn} onClick={onGetChildren}>
                            DataChannel: getChildrenRequest /World
                        </button>
                        <button type="button" style={secondaryBtn} onClick={onFocusWorld}>
                            DataChannel: focusPrimRequest /World
                        </button>
                        <button type="button" style={secondaryBtn} onClick={onEmitCoordinatorHighlight}>
                            Socket.IO: highlightRequest 廣播
                        </button>

                        <LogBlock title="stream-config" entries={streamConfig ? [{ at: "", label: "stream-config", payload: streamConfig }] : []} />
                        <LogBlock title="DataChannel sent" entries={outgoingMessages} />
                        <LogBlock title="DataChannel received" entries={incomingMessages} />
                        <TextLogBlock title="Socket.IO events" items={socketEvents} />
                    </div>
                </details>
            </div>

            {/* Footer nav */}
            <div
                style={{
                    flexShrink: 0,
                    padding: "10px 14px",
                    background: "var(--demo-bg-elevated)",
                    borderTop: "1px solid var(--demo-border)",
                    fontSize: 12,
                    color: "var(--demo-text-secondary)",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                }}
            >
                <span>步驟 ④ 標記問題</span>
                <a href="http://127.0.0.1:8001" target="_blank" rel="noreferrer" style={{ color: "var(--demo-brand)", textDecoration: "none", fontWeight: 500 }}>
                    下一步 → 紀錄回寫 (⑤)
                </a>
            </div>
        </div>
    );
}

function inferKind(status: string): "ok" | "warn" | "bad" | "idle" {
    const s = status || "";
    if (/錯誤|失敗|斷線|無法|未連線|offline|error|fail/i.test(s)) return "bad";
    if (/已開啟|已連線|就緒|完成|成功|active|ready|connected/i.test(s)) return "ok";
    if (/載入中|連線中|等待|查詢中|loading|connecting|wait/i.test(s)) return "warn";
    return "idle";
}

function shortLabel(kind: string): string {
    if (kind === "ok") return "進行中";
    if (kind === "warn") return "處理中";
    if (kind === "bad") return "需處理";
    return "尚未啟動";
}

function mappingOptionLabel(item: ElementMappingItem, index: number): string {
    const guid = item.ifc_guid || "no-guid";
    const path = item.usd_prim_path || "no-prim-path";
    const method = item.mapping_method || "unknown";
    const confidence = typeof item.mapping_confidence === "number" ? item.mapping_confidence.toFixed(2) : "n/a";
    return `${index + 1}. ${guid} -> ${path} (${method}, ${confidence})`;
}

function LogBlock({ title, entries }: { title: string; entries: DemoLogEntry[] }) {
    return (
        <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 12, color: "var(--demo-text-secondary)" }}>{title}</strong>
            <pre
                style={{
                    maxHeight: 140,
                    overflow: "auto",
                    background: "#0e1116",
                    color: "#d6e2f0",
                    padding: 8,
                    borderRadius: "var(--demo-radius)",
                    fontFamily: "var(--demo-font-mono)",
                    fontSize: 11,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    marginTop: 4,
                }}
            >
                {entries.length === 0
                    ? "尚無資料"
                    : entries
                          .slice(0, 5)
                          .map((entry) => `${entry.at ? `${entry.at} ` : ""}${entry.label}\n${JSON.stringify(entry.payload, null, 2)}`)
                          .join("\n\n")}
            </pre>
        </div>
    );
}

function TextLogBlock({ title, items }: { title: string; items: string[] }) {
    return (
        <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 12, color: "var(--demo-text-secondary)" }}>{title}</strong>
            <pre
                style={{
                    maxHeight: 140,
                    overflow: "auto",
                    background: "#0e1116",
                    color: "#d6e2f0",
                    padding: 8,
                    borderRadius: "var(--demo-radius)",
                    fontFamily: "var(--demo-font-mono)",
                    fontSize: 11,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    marginTop: 4,
                }}
            >
                {items.length === 0 ? "尚無資料" : items.slice(-10).reverse().join("\n")}
            </pre>
        </div>
    );
}
