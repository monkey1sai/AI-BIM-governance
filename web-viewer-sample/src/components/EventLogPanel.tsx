interface EventLogPanelProps {
    events: string[];
    width: number;
}

export default function EventLogPanel({ events, width }: EventLogPanelProps) {
    const recent = events.slice(-12).reverse();
    return (
        <div
            className="demo-root"
            style={{ width, borderBottom: "1px solid var(--demo-border)", background: "var(--demo-bg-elevated)" }}
        >
            <div
                style={{
                    padding: "10px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                <span style={{ fontSize: 14, fontWeight: 600 }}>即時審查事件 (Live events)</span>
                <span style={{ fontSize: 12, color: "var(--demo-text-muted)" }}>{events.length} 筆</span>
            </div>

            <div style={{ padding: "0 14px 10px", maxHeight: 220, overflow: "auto" }}>
                {recent.length === 0 && (
                    <div style={{ fontSize: 12, color: "var(--demo-text-muted)" }}>尚未有事件。建立或加入審查會議後，操作會出現在這裡。</div>
                )}
                {recent.map((event, index) => {
                    const friendly = humanize(event);
                    return (
                        <div
                            key={`${event}-${index}`}
                            style={{
                                display: "flex",
                                gap: 10,
                                padding: "6px 0",
                                borderBottom: "1px solid var(--demo-border)",
                                fontSize: 12,
                            }}
                        >
                            <span style={{ color: "var(--demo-text-primary)", flex: 1 }}>{friendly.label}</span>
                            <span style={{ color: "var(--demo-text-muted)", fontFamily: "var(--demo-font-mono)" }}>{friendly.tag}</span>
                        </div>
                    );
                })}
            </div>

            {recent.length > 0 && (
                <details style={{ padding: "0 14px 10px" }}>
                    <summary style={{ fontSize: 12, color: "var(--demo-text-secondary)", cursor: "pointer" }}>
                        展開技術細節 (Show technical details)
                    </summary>
                    <pre
                        style={{
                            marginTop: 8,
                            padding: 10,
                            background: "#0e1116",
                            color: "#d6e2f0",
                            borderRadius: "var(--demo-radius)",
                            fontFamily: "var(--demo-font-mono)",
                            fontSize: 11,
                            maxHeight: 200,
                            overflow: "auto",
                            whiteSpace: "pre-wrap",
                            wordBreak: "break-word",
                        }}
                    >
                        {recent.join("\n")}
                    </pre>
                </details>
            )}
        </div>
    );
}

function humanize(raw: string): { label: string; tag: string } {
    const s = String(raw);
    if (/connect|connected|已連線/i.test(s) && !/disconnect/i.test(s)) return { label: "已連上即時頻道", tag: "connect" };
    if (/disconnect|斷線|斷開/i.test(s)) return { label: "即時頻道中斷", tag: "disconnect" };
    if (/joinSession/i.test(s)) return { label: "使用者加入審查會議", tag: "join" };
    if (/leaveSession/i.test(s)) return { label: "使用者離開審查會議", tag: "leave" };
    if (/highlightPrimsResult/i.test(s)) return { label: "模型已完成高亮", tag: "highlight-result" };
    if (/highlightPrimsRequest|highlightRequest/i.test(s)) return { label: "送出問題高亮", tag: "highlight" };
    if (/clearHighlight/i.test(s)) return { label: "清除高亮", tag: "clear" };
    if (/focusPrim/i.test(s)) return { label: "聚焦元件", tag: "focus" };
    if (/openStage|openedStage/i.test(s)) return { label: "開啟可審查模型", tag: "stage" };
    if (/loadingState/i.test(s)) return { label: "查詢模型載入狀態", tag: "loading" };
    if (/getChildren/i.test(s)) return { label: "讀取模型結構", tag: "tree" };
    if (/selectPrims|selectionUpdate|stageSelectionChanged/i.test(s)) return { label: "同步元件選取", tag: "select" };
    if (/annotationCreated/i.test(s)) return { label: "標註已寫入主資料庫", tag: "annotation" };
    if (/annotationCreate/i.test(s)) return { label: "建立審查標註", tag: "annotation" };
    if (/presenceUpdated/i.test(s)) return { label: "與會者列表更新", tag: "presence" };
    if (/heartbeat/i.test(s)) return { label: "心跳", tag: "heartbeat" };
    return { label: s.slice(0, 60), tag: "" };
}
