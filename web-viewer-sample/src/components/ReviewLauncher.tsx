interface ReviewLauncherProps {
    status: string;
    width: number;
}

export default function ReviewLauncher({ status, width }: ReviewLauncherProps) {
    const kind = inferStatusKind(status);
    return (
        <div
            className="demo-root"
            style={{ width, borderBottom: "1px solid var(--demo-border)", background: "var(--demo-bg-elevated)" }}
        >
            <div
                style={{
                    padding: "10px 14px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                }}
            >
                <span style={{ fontSize: 14, fontWeight: 600 }}>審查狀態 (Review status)</span>
                <span className={`demo-status demo-status--${kind}`}>{shortLabel(kind, status)}</span>
            </div>
            <div style={{ padding: "0 14px 10px", fontSize: 12, color: "var(--demo-text-secondary)" }}>{status}</div>
        </div>
    );
}

function inferStatusKind(status: string): "ok" | "warn" | "bad" | "idle" {
    const s = status || "";
    if (/錯誤|失敗|斷線|無法|未連線|offline|error|fail/i.test(s)) return "bad";
    if (/已開啟|已連線|就緒|完成|成功|active|ready|connected/i.test(s)) return "ok";
    if (/載入中|連線中|等待|查詢中|loading|connecting|wait/i.test(s)) return "warn";
    return "idle";
}

function shortLabel(kind: string, status: string): string {
    if (kind === "ok") return "進行中";
    if (kind === "warn") return "處理中";
    if (kind === "bad") return "需處理";
    return status?.slice(0, 12) || "—";
}
