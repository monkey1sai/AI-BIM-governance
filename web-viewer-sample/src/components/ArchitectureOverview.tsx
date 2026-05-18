const architectureNodes = [
    {
        id: "external-worker",
        title: "External IFC Worker",
        role: "Customer-edge IFC producer",
        details: ["produces IFC", "calls coordinator intake", "external system"],
        tone: "authority",
    },
    {
        id: "cloud-control",
        title: "Company cloud bim-control",
        role: "External control-plane authority",
        details: ["project / model metadata", "callback receiver", "not a local runtime"],
        tone: "storage",
    },
    {
        id: "coordinator",
        title: "bim-review-coordinator",
        role: "IFC-ready intake + Session Control Plane",
        details: ["service auth / idempotency", "callback outbox", "stream config routing"],
        tone: "control",
    },
    {
        id: "streaming",
        title: "bim-streaming-server",
        role: "IFC→USDC Authority + Omniverse Kit Runtime",
        details: ["internal conversion", "GPU rendering / WebRTC", "DataChannel scene commands"],
        tone: "runtime",
    },
    {
        id: "viewer",
        title: "web-viewer-sample",
        role: "Browser Client",
        details: ["review UI", "WebRTC viewer", "issue / prim interactions"],
        tone: "client",
    },
];

const architectureFlows = [
    "External IFC Worker → bim-review-coordinator: POST /api/external/ifc-ready",
    "bim-review-coordinator → bim-streaming-server: internal conversion request",
    "bim-review-coordinator → company cloud: metadata-only callback outbox",
    "web-viewer-sample ↔ bim-streaming-server: WebRTC video + DataChannel JSON",
    "web-viewer-sample ↔ bim-review-coordinator: Socket.IO presence / collaboration",
];

const boundaryRules = [
    "對外 IFC-ready intake 歸 coordinator",
    "IFC→USDC conversion 歸 streaming server",
    "雲端 callback 歸 coordinator outbox",
    "session / collaboration 歸 coordinator",
    "3D runtime 歸 streaming server",
    "使用者操作歸 web viewer",
];

export default function ArchitectureOverview() {
    return (
        <section className="architecture-overview" aria-labelledby="architecture-overview-title">
            <div className="architecture-copy">
                <p className="architecture-eyebrow">AI-BIM Governance Workspace</p>
                <h2 id="architecture-overview-title">Project Architecture UI</h2>
                <p>
                    B 方案以 coordinator 作唯一外部 intake，streaming server 擁有 IFC→USDC 與 3D runtime，外部平台只由 tests/fakes 模擬。
                </p>
            </div>

            <div className="architecture-map" aria-label="Repository responsibility map">
                {architectureNodes.map((node) => (
                    <article key={node.id} className={`architecture-node architecture-node--${node.tone}`}>
                        <div className="architecture-node__title">{node.title}</div>
                        <div className="architecture-node__role">{node.role}</div>
                        <ul>
                            {node.details.map((detail) => (
                                <li key={detail}>{detail}</li>
                            ))}
                        </ul>
                    </article>
                ))}
            </div>

            <div className="architecture-flow-grid">
                <div className="architecture-flow-card">
                    <h3>Primary Data Flow</h3>
                    <ol>
                        {architectureFlows.map((flow) => (
                            <li key={flow}>{flow}</li>
                        ))}
                    </ol>
                </div>
                <div className="architecture-flow-card architecture-flow-card--rules">
                    <h3>Boundary Rules</h3>
                    <ul>
                        {boundaryRules.map((rule) => (
                            <li key={rule}>{rule}</li>
                        ))}
                    </ul>
                </div>
            </div>
        </section>
    );
}
