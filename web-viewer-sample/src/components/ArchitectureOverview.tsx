const architectureNodes = [
    {
        id: "control",
        title: "_bim-control",
        role: "Fake BIM Data Authority",
        details: ["project / model metadata", "artifact / issue / annotation records", "element mapping metadata"],
        tone: "authority",
    },
    {
        id: "worker",
        title: "_worker",
        role: "File + Conversion Boundary",
        details: ["dev IFC source selection", "USDC artifacts", "mapping / lineage files"],
        tone: "storage",
    },
    {
        id: "coordinator",
        title: "bim-review-coordinator",
        role: "Session / Collaboration Control Plane",
        details: ["review session lifecycle", "stream config routing", "presence / collaboration events"],
        tone: "control",
    },
    {
        id: "streaming",
        title: "bim-streaming-server",
        role: "Omniverse Kit Runtime",
        details: ["USD stage runtime", "GPU rendering / WebRTC", "DataChannel scene commands"],
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
    "web-viewer-sample → bim-review-coordinator: create / join review session",
    "bim-review-coordinator → _bim-control: query model, artifact, issue metadata",
    "_worker → _bim-control: publish artifact metadata and readiness",
    "web-viewer-sample ↔ bim-streaming-server: WebRTC video + DataChannel JSON",
    "bim-streaming-server → _worker: load USD / USDC bytes",
    "web-viewer-sample ↔ bim-review-coordinator: Socket.IO presence / collaboration",
];

const boundaryRules = [
    "資料權威歸 _bim-control",
    "檔案與轉檔邊界歸 _worker",
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
                    五個核心 repo / folder 依資料權威、檔案轉檔、session 控制、3D runtime 與瀏覽器操作分工。
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
