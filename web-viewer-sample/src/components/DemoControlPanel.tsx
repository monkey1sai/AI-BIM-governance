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

const panelStyle: React.CSSProperties = {
    background: "#FEFEFE",
    color: "#3d4852",
    borderLeft: "1px solid #d8d8d8",
    borderBottom: "1px solid #d8d8d8",
    boxShadow: "0 0 8px rgba(0,0,0,0.16)",
};

const buttonStyle: React.CSSProperties = {
    width: "100%",
    minHeight: 30,
    marginBottom: 6,
    textAlign: "left",
    padding: "6px 8px",
    whiteSpace: "normal",
};

export default function DemoControlPanel({
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
}: DemoControlPanelProps) {
    const selectedMapping = mappingItems[selectedMappingIndex] || null;
    const disableMappingVerification = !selectedMapping || !!mappingVerificationBlockedReason;
    return (
        <div style={{ ...panelStyle, width }}>
            <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 700 }}>Demo 操作面板</div>
            <div style={{ padding: 8, fontSize: 12, maxHeight: "calc(100vh - 110px)", overflow: "auto" }}>
                <div style={{ marginBottom: 8 }}>
                    <strong>Review Session</strong>
                    <div>{sessionId || "尚未建立"}</div>
                    <div>{reviewStatus}</div>
                    <div>模型狀態：{streamConfig?.model.status || "未知"}</div>
                    <div style={{ wordBreak: "break-all" }}>成果檔 URL：{selectedAssetUrl || "尚未選取"}</div>
                </div>

                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onCreateOrLoadSession}>
                    建立或載入 review session
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onLoadBootstrap}>
                    載入 review-bootstrap
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onConnectSocket}>
                    連線或重連 Socket.IO
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onOpenStage}>
                    送出 openStageRequest 開啟模型
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onLoadingState}>
                    送出 loadingStateQuery 查詢載入狀態
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onGetChildren}>
                    送出 getChildrenRequest /World 載入 stage tree
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onHighlightWorld}>
                    送出 highlightPrimsRequest /World smoke-only 高亮
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onFocusWorld}>
                    送出 focusPrimRequest /World smoke-only 聚焦
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onClearHighlight}>
                    送出 clearHighlightRequest 清除高亮
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onEmitCoordinatorHighlight}>
                    廣播 coordinator highlightRequest
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onCreateAnnotation}>
                    建立標註 annotationCreate
                </button>

                <div style={{ marginTop: 10, padding: 8, border: "1px solid #d8d8d8", background: "#fafafa" }}>
                    <strong>Mapping 驗證</strong>
                    <div style={{ marginTop: 4, wordBreak: "break-all" }}>mapping_url：{mappingUrl || "尚未取得"}</div>
                    <div>狀態：{mappingStatus}</div>
                    {mappingSummary && (
                        <div style={{ marginTop: 4 }}>
                            mapped={mappingSummary.mapped_count ?? 0} / fake={mappingSummary.fake_mapping_count ?? 0} / unmapped IFC={mappingSummary.unmapped_ifc_count ?? 0} / unmapped USD={mappingSummary.unmapped_usd_count ?? 0}
                        </div>
                    )}
                    {mappingVerificationBlockedReason && (
                        <div style={{ marginTop: 4, padding: 6, border: "1px solid #c77700", background: "#fff7e6", color: "#6b4200" }}>
                            {mappingVerificationBlockedReason}
                        </div>
                    )}
                    <button type="button" className="nvidia-button" style={{ ...buttonStyle, marginTop: 6 }} onClick={onLoadMapping} disabled={!mappingUrl}>
                        載入 element_mapping.json
                    </button>
                    <select
                        value={selectedMappingIndex}
                        onChange={(event) => onSelectMappingIndex(Number(event.target.value))}
                        disabled={mappingItems.length === 0}
                        style={{ width: "100%", marginBottom: 6, padding: 4 }}
                    >
                        {mappingItems.length === 0 && <option value={0}>沒有可驗證 mapping item</option>}
                        {mappingItems.map((item, index) => (
                            <option key={`${item.ifc_guid || "no-guid"}-${item.usd_prim_path || "no-path"}-${index}`} value={index}>
                                {mappingOptionLabel(item, index)}
                            </option>
                        ))}
                    </select>
                    {selectedMapping && (
                        <pre style={{ maxHeight: 120, overflow: "auto", background: "#eef3f8", padding: 6, whiteSpace: "pre-wrap" }}>
                            {JSON.stringify(selectedMapping, null, 2)}
                        </pre>
                    )}
                    <button type="button" className="nvidia-button" style={buttonStyle} onClick={onHighlightSelectedMapping} disabled={disableMappingVerification}>
                        用選取 mapping 送 highlightPrimsRequest
                    </button>
                    <button type="button" className="nvidia-button" style={buttonStyle} onClick={onFocusSelectedMapping} disabled={disableMappingVerification}>
                        用選取 mapping 送 focusPrimRequest
                    </button>
                    <div style={{ marginTop: 4 }}>驗證結果：{lastMappingVerification || "尚未執行"}</div>
                </div>

                <LogBlock title="最新 stream-config" entries={streamConfig ? [{ at: "", label: "stream-config", payload: streamConfig }] : []} />
                <LogBlock title="DataChannel 送出訊息" entries={outgoingMessages} />
                <LogBlock title="DataChannel 收到訊息" entries={incomingMessages} />
                <TextLogBlock title="Socket.IO 收到事件" items={socketEvents} />
            </div>
        </div>
    );
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
            <strong>{title}</strong>
            <pre style={{ maxHeight: 140, overflow: "auto", background: "#f5f7fa", padding: 6, whiteSpace: "pre-wrap" }}>
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
            <strong>{title}</strong>
            <pre style={{ maxHeight: 140, overflow: "auto", background: "#f5f7fa", padding: 6, whiteSpace: "pre-wrap" }}>
                {items.length === 0 ? "尚無資料" : items.slice(-10).reverse().join("\n")}
            </pre>
        </div>
    );
}
