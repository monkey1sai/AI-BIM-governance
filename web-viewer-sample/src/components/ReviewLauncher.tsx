interface ReviewLauncherProps {
    status: string;
    width: number;
}

export default function ReviewLauncher({ status, width }: ReviewLauncherProps) {
    return (
        <div style={{ width, background: "#FEFEFE", color: "#656565", borderBottom: "1px solid #d8d8d8" }}>
            <div style={{ padding: "10px 12px", fontSize: 16, fontWeight: 600 }}>Review</div>
            <div style={{ padding: 8, fontSize: 12 }}>{status}</div>
        </div>
    );
}
