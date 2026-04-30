import type React from "react";
import type { DemoLogEntry } from "../types/demo";
import type { ReviewStreamConfig } from "../types/review";

interface DemoControlPanelProps {
    width: number;
    sessionId: string | null;
    reviewStatus: string;
    selectedAssetUrl: string | null;
    streamConfig: ReviewStreamConfig | null;
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
}: DemoControlPanelProps) {
    return (
        <div style={{ ...panelStyle, width }}>
            <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 700 }}>Demo Controls</div>
            <div style={{ padding: 8, fontSize: 12, maxHeight: "calc(100vh - 110px)", overflow: "auto" }}>
                <div style={{ marginBottom: 8 }}>
                    <strong>Session</strong>
                    <div>{sessionId || "none"}</div>
                    <div>{reviewStatus}</div>
                    <div>Model: {streamConfig?.model.status || "unknown"}</div>
                    <div style={{ wordBreak: "break-all" }}>Asset: {selectedAssetUrl || "none"}</div>
                </div>

                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onCreateOrLoadSession}>
                    Create / load review session
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onLoadBootstrap}>
                    Load review-bootstrap
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onConnectSocket}>
                    Connect / reconnect Socket.IO
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onOpenStage}>
                    Send openStageRequest
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onLoadingState}>
                    Send loadingStateQuery
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onGetChildren}>
                    Send getChildrenRequest /World
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onHighlightWorld}>
                    Send highlightPrimsRequest /World
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onFocusWorld}>
                    Send focusPrimRequest /World
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onClearHighlight}>
                    Send clearHighlightRequest
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onEmitCoordinatorHighlight}>
                    Emit coordinator highlightRequest
                </button>
                <button type="button" className="nvidia-button" style={buttonStyle} onClick={onCreateAnnotation}>
                    Create annotation
                </button>

                <LogBlock title="Latest stream-config" entries={streamConfig ? [{ at: "", label: "stream-config", payload: streamConfig }] : []} />
                <LogBlock title="DataChannel outgoing" entries={outgoingMessages} />
                <LogBlock title="DataChannel incoming" entries={incomingMessages} />
                <TextLogBlock title="Socket.IO incoming events" items={socketEvents} />
            </div>
        </div>
    );
}

function LogBlock({ title, entries }: { title: string; entries: DemoLogEntry[] }) {
    return (
        <div style={{ marginTop: 10 }}>
            <strong>{title}</strong>
            <pre style={{ maxHeight: 140, overflow: "auto", background: "#f5f7fa", padding: 6, whiteSpace: "pre-wrap" }}>
                {entries.length === 0
                    ? "none"
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
                {items.length === 0 ? "none" : items.slice(-10).reverse().join("\n")}
            </pre>
        </div>
    );
}
