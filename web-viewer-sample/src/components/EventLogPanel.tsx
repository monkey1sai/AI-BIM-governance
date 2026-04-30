interface EventLogPanelProps {
    events: string[];
    width: number;
}

export default function EventLogPanel({ events, width }: EventLogPanelProps) {
    return (
        <div style={{ width, background: "#FEFEFE", color: "#656565", borderBottom: "1px solid #d8d8d8" }}>
            <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 600 }}>事件紀錄</div>
            <div style={{ padding: 8, fontSize: 12, maxHeight: 120, overflow: "auto" }}>
                {events.slice(-6).map((event, index) => (
                    <div key={`${event}-${index}`}>{event}</div>
                ))}
                {events.length === 0 && <div>目前沒有事件</div>}
            </div>
        </div>
    );
}
