interface PresencePanelProps {
    sessionId: string | null;
    width: number;
}

export default function PresencePanel({ sessionId, width }: PresencePanelProps) {
    return (
        <div style={{ width, background: "#FEFEFE", color: "#656565", borderBottom: "1px solid #d8d8d8" }}>
            <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 600 }}>Session</div>
            <div style={{ padding: 8, fontSize: 12, overflowWrap: "anywhere" }}>
                {sessionId || "No review session"}
            </div>
        </div>
    );
}
