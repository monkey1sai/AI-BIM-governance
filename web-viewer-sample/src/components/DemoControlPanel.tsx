import type React from "react";
import type { DemoLogEntry } from "../types/demo";
import type { ElementMappingItem, ElementMappingSummary } from "../types/mapping";
import type { ConversionQualityMetricsSummary, ReviewStreamConfig } from "../types/review";
import ConversionSummaryCard, { type SmokeBlockerHint } from "./ConversionSummaryCard";

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
    smokeBlockerHint?: SmokeBlockerHint | null;
    /**
     * Optional override for the conversion summary card dev-only fallback fetcher. Production
     * builds MUST NOT pass this. Tests inject it to verify dev-only behavior deterministically.
     */
    conversionSummaryFetchFallback?: (conversionJobId: string) => Promise<ConversionQualityMetricsSummary | null>;
    onCreateOrLoadSession: () => void;
    // fast-mvp loop: optional, no-op default; 對應 button 等 Change 2 viewer 重做時整段刪
    onLoadBootstrap?: () => void;
    onConnectSocket: () => void;
    onOpenStage: () => void;
    onLoadingState: () => void;
    onGetChildren: () => void;
    onHighlightWorld?: () => void;
    onFocusWorld: () => void;
    onClearHighlight: () => void;
    onEmitCoordinatorHighlight?: () => void;
    onCreateAnnotation?: () => void;
    onLoadMapping: () => void;
    onSelectMappingIndex: (index: number) => void;
    onHighlightSelectedMapping: () => void;
    onFocusSelectedMapping: () => void;
}

type StatusKind = "ok" | "warn" | "bad" | "idle";

interface RepoGuideCard {
    num: string;
    repo: string;
    role: string;
    protocol: string;
    status: string;
    statusKind: StatusKind;
    evidence: string;
    owns: string;
    gap?: string;
}

interface DemoFlowStep {
    num: string;
    title: string;
    route: string;
    protocol: string;
    status: string;
    statusKind: StatusKind;
    actionLabel?: string;
    action?: () => void;
    disabled?: boolean;
    gap?: string;
}

interface InteractionLabCard {
    num: string;
    title: string;
    route: string;
    status: string;
    statusKind: StatusKind;
    description: string;
    effect: string;
    actionLabel: string;
    action: () => void;
    disabled?: boolean;
    gap?: string;
}

const stepDefs: { num: string; name: string; href: string; active?: boolean }[] = [
    { num: "①", name: "上傳建模 (Upload)",  href: "http://127.0.0.1:8004/dev-console" },
    { num: "②", name: "自動轉換 (Convert)", href: "http://127.0.0.1:8004/dev-console" },
    { num: "③", name: "建立會議 (Meeting)", href: "http://127.0.0.1:8004" },
    { num: "④", name: "標記問題 (Mark)",    href: "#",                     active: true },
    { num: "⑤", name: "紀錄回寫 (Record)",  href: "http://127.0.0.1:8004/dev-console" },
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

const guideCardStyle: React.CSSProperties = {
    borderBottom: "1px solid var(--demo-border)",
    padding: "9px 0",
    marginBottom: 0,
};

const miniLabelStyle: React.CSSProperties = {
    display: "block",
    marginTop: 6,
    color: "var(--demo-text-muted)",
    fontSize: 11,
};

const protocolPillStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    padding: "2px 7px",
    borderRadius: 999,
    border: "1px solid var(--demo-border)",
    background: "var(--demo-bg-card)",
    color: "var(--demo-text-secondary)",
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap",
};

const labGridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 8,
    marginTop: 10,
};

const labCardStyle: React.CSSProperties = {
    padding: 10,
    border: "1px solid var(--demo-border)",
    borderRadius: "var(--demo-radius)",
    background: "var(--demo-bg-card)",
};

const labEffectStyle: React.CSSProperties = {
    padding: 8,
    marginTop: 7,
    borderLeft: "3px solid var(--demo-brand)",
    background: "var(--demo-brand-soft)",
    color: "var(--demo-text-secondary)",
    fontSize: 11,
};

const labGapStyle: React.CSSProperties = {
    padding: 8,
    marginTop: 7,
    borderLeft: "3px solid var(--demo-status-warn)",
    background: "var(--demo-status-warn-soft)",
    color: "var(--demo-text-secondary)",
    fontSize: 11,
};

const rawSummaryStyle: React.CSSProperties = {
    cursor: "pointer",
    fontSize: 12,
    color: "var(--demo-text-secondary)",
    fontWeight: 600,
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
        smokeBlockerHint,
        conversionSummaryFetchFallback,
        onCreateOrLoadSession,
        onLoadBootstrap = () => undefined,
        onConnectSocket,
        onOpenStage,
        onLoadingState,
        onGetChildren,
        onHighlightWorld = () => undefined,
        onFocusWorld,
        onClearHighlight,
        onEmitCoordinatorHighlight = () => undefined,
        onCreateAnnotation = () => undefined,
        onLoadMapping,
        onSelectMappingIndex,
        onHighlightSelectedMapping,
        onFocusSelectedMapping,
    } = props;

    const selectedMapping = mappingItems[selectedMappingIndex] || null;
    const disableMappingVerification = !selectedMapping || !!mappingVerificationBlockedReason;
    const modelKind = streamConfig?.model.status === "ready" ? "ok" : streamConfig ? "warn" : "idle";
    const reviewKind = inferKind(reviewStatus);
    const recordHref = withSessionId("http://127.0.0.1:8004/dev-console", sessionId);
    const hasStreamResponse = incomingMessages.some((entry) =>
        /openedStageResult|loadingStateResponse|getChildrenResponse|highlightPrimsResult|focusPrimResult|stageSelectionChanged/i.test(entry.label)
    );
    const hasStreamCommand = outgoingMessages.length > 0;
    const hasCoordinatorEvidence = !!sessionId || socketEvents.some((event) => /Socket\.IO|session|review-bootstrap|會議/i.test(event));
    const hasMetadataEvidence = !!streamConfig || !!mappingUrl || socketEvents.some((event) => /review 資料|metadata|shadow/i.test(event));
    const hasArtifactUrlEvidence = !!selectedAssetUrl || !!mappingUrl;
    const repoGuideCards: RepoGuideCard[] = [
        {
            num: "①",
            repo: "web-viewer-sample",
            role: "Browser Client / 使用者操作入口",
            protocol: "REST / WebSocket / DataChannel",
            status: "目前正在操作",
            statusKind: "ok",
            evidence: "右側面板負責把使用者操作轉成 session、metadata、stream command 與 annotation event。",
            owns: "UI state、操作意圖、顯示用 cache",
        },
        {
            num: "②",
            repo: "bim-review-coordinator",
            role: "Session / Collaboration Control Plane",
            protocol: "REST + Socket.IO",
            status: hasCoordinatorEvidence ? "已接入 demo 流程" : "待建立 session",
            statusKind: hasCoordinatorEvidence ? "ok" : reviewKind === "bad" ? "bad" : "warn",
            evidence: sessionId ? `Session id：${sessionId}` : reviewStatus,
            owns: "review session、presence、collaboration event、stream config",
        },
        {
            num: "③",
            repo: "company-cloud bim-control",
            role: "External control-plane authority / 本地僅 shadow",
            protocol: "REST metadata",
            status: hasMetadataEvidence ? "metadata 已進入 UI" : "尚未取得 metadata",
            statusKind: hasMetadataEvidence ? "ok" : reviewKind === "bad" ? "bad" : "idle",
            evidence: streamConfig ? `model=${streamConfig.model.status}, artifacts=${streamConfig.artifacts.length}` : "等待 review-bootstrap 或 fallback metadata。",
            owns: "project、model version、artifact、issue、annotation metadata 權威在外部雲端",
        },
        {
            num: "④",
            repo: "external IFC Worker",
            role: "Customer-edge IFC producer",
            protocol: "POST /api/external/ifc-ready",
            status: hasArtifactUrlEvidence ? "已取得檔案 URL" : "等待 artifact URL",
            statusKind: hasArtifactUrlEvidence ? "ok" : "idle",
            evidence: selectedAssetUrl || mappingUrl || "IFC-ready handoff / streaming result URL 尚未出現在本場 demo。",
            owns: "產出 IFC 並通知 coordinator；不在本 repo runtime 內",
        },
        {
            num: "⑤",
            repo: "bim-streaming-server conversion",
            role: "Streaming-owned IFC→USDC job",
            protocol: "REST conversion authority",
            status: hasArtifactUrlEvidence ? "已完成前置轉檔" : "等待 IFC-ready",
            statusKind: hasArtifactUrlEvidence ? "ok" : "warn",
            evidence: hasArtifactUrlEvidence ? "本場 session 已拿到 streaming-owned model/mapping URL。" : "等待 external IFC-ready 或 streaming conversion evidence。",
            owns: "IFC→USDC job、mapping quality、model.usdc readiness、conversion result callback",
        },
        {
            num: "⑥",
            repo: "bim-streaming-server",
            role: "Omniverse Kit Runtime / WebRTC + DataChannel",
            protocol: "WebRTC + DataChannel",
            status: hasStreamResponse ? "DataChannel 已回應" : hasStreamCommand ? "已送出 stream command" : "等待 stream command",
            statusKind: hasStreamResponse ? "ok" : hasStreamCommand ? "warn" : "idle",
            evidence: hasStreamResponse ? incomingMessages[0]?.label || "收到 Kit event" : "用下方 Open Stage / Highlight / Focus 送出指令。",
            owns: "IFC→USDC authority、USD runtime、viewport rendering、selection、camera、highlight overlay",
        },
    ];
    const demoFlowSteps: DemoFlowStep[] = [
        {
            num: "1",
            title: "建立 / 載入審查會議",
            route: "web-viewer-sample -> bim-review-coordinator",
            protocol: "REST",
            status: sessionId ? "已完成" : "可操作",
            statusKind: sessionId ? "ok" : "warn",
            actionLabel: sessionId ? "重新載入 session" : "建立 session",
            action: onCreateOrLoadSession,
        },
        {
            num: "2",
            title: "取得模型、議題與 artifact metadata",
            route: "coordinator -> company-cloud shadow/outbox",
            protocol: "REST",
            status: hasMetadataEvidence ? "metadata 已取得" : "等待 bootstrap",
            statusKind: hasMetadataEvidence ? "ok" : "idle",
            actionLabel: "載入 bootstrap",
            action: onLoadBootstrap,
        },
        {
            num: "3",
            title: "確認檔案與 mapping URL",
            route: "coordinator -> streaming artifact refs",
            protocol: "Streaming artifact URL",
            status: hasArtifactUrlEvidence ? "URL 已顯示" : "等待 artifact",
            statusKind: hasArtifactUrlEvidence ? "ok" : "idle",
            actionLabel: "載入 mapping",
            action: onLoadMapping,
            disabled: !mappingUrl,
        },
        {
            num: "4",
            title: "連線協作事件通道",
            route: "web-viewer-sample <-> coordinator",
            protocol: "Socket.IO",
            status: socketEvents.some((event) => /Socket\.IO 已連線/i.test(event)) ? "已連線" : "可操作",
            statusKind: socketEvents.some((event) => /Socket\.IO 已連線/i.test(event)) ? "ok" : sessionId ? "warn" : "idle",
            actionLabel: "連線即時頻道",
            action: onConnectSocket,
            disabled: !sessionId,
        },
        {
            num: "5",
            title: "載入 USDC 到 Omniverse stream",
            route: "web-viewer-sample -> bim-streaming-server -> edge artifact refs",
            protocol: "DataChannel",
            status: hasStreamCommand ? "已送出指令" : "可操作",
            statusKind: hasStreamResponse ? "ok" : hasStreamCommand ? "warn" : selectedAssetUrl ? "idle" : "bad",
            actionLabel: "Open stage",
            action: onOpenStage,
            disabled: !selectedAssetUrl,
        },
        {
            num: "6",
            title: "標示問題與聚焦元件",
            route: "web-viewer-sample <-> bim-streaming-server",
            protocol: "DataChannel",
            status: hasStreamResponse ? "已有回應" : "等待 Kit 回應",
            statusKind: hasStreamResponse ? "ok" : hasStreamCommand ? "warn" : "idle",
            actionLabel: "高亮示範問題",
            action: onHighlightWorld,
        },
        {
            num: "7",
            title: "建立審查標註並回寫",
            route: "web-viewer-sample -> coordinator -> callback outbox",
            protocol: "Socket.IO / REST",
            status: sessionId ? "可操作" : "需先建立 session",
            statusKind: sessionId ? "warn" : "idle",
            actionLabel: "建立標註",
            action: onCreateAnnotation,
            disabled: !sessionId,
        },
        {
            num: "8",
            title: "從 demo 介面觸發 IFC -> USDC 轉檔",
            route: "external IFC Worker -> coordinator -> streaming",
            protocol: "REST B-scheme intake",
            status: hasArtifactUrlEvidence ? "已完成" : "等待 IFC-ready",
            statusKind: hasArtifactUrlEvidence ? "ok" : "warn",
            disabled: false,
            actionLabel: "開啟 coordinator console",
            action: () => window.open("http://127.0.0.1:8004/dev-console", "_blank", "noopener,noreferrer"),
            gap: hasArtifactUrlEvidence ? undefined : "請先讓外部 IFC Worker 送出 ifc-ready，或用 coordinator console 查看 B-scheme intake。",
        },
    ];
    const latestOutgoingLabel = outgoingMessages[0]?.label || "尚未送出 DataChannel command";
    const latestIncomingLabel = incomingMessages[0]?.label || "尚未收到 DataChannel 回應";
    const latestSocketEvent = socketEvents.length > 0 ? socketEvents[socketEvents.length - 1] : "尚未收到 Socket.IO event";
    const interactionLabCards: InteractionLabCard[] = [
        {
            num: "REST",
            title: "載入審查資料包",
            route: "viewer -> coordinator -> shadow metadata / streaming refs",
            status: streamConfig ? "已取得" : "可操作",
            statusKind: streamConfig ? "ok" : sessionId ? "warn" : "idle",
            description: "取得 session、model artifact、issue、mapping URL，讓畫面知道要載入哪個模型與問題資料。",
            effect: streamConfig
                ? `觀察效果：stream-config 已顯示 ${streamConfig.artifacts.length} 個 artifact。`
                : "觀察效果：本場審查會議與架構導覽會更新 metadata / storage 狀態。",
            actionLabel: "載入 review-bootstrap",
            action: onLoadBootstrap,
        },
        {
            num: "RTC",
            title: "載入 3D 串流模型",
            route: "viewer -> bim-streaming-server -> edge artifact refs",
            status: hasStreamCommand ? "已送出指令" : "等待操作",
            statusKind: hasStreamResponse ? "ok" : hasStreamCommand ? "warn" : selectedAssetUrl ? "idle" : "bad",
            description: "把 USDC URL 透過 DataChannel 交給 Kit runtime，左側畫面會從等待狀態進入載入流程。",
            effect: hasStreamResponse
                ? `觀察效果：最近收到 ${latestIncomingLabel}。`
                : `觀察效果：左側畫面與 DataChannel sent 會出現 ${latestOutgoingLabel}。`,
            actionLabel: "Open stage",
            action: onOpenStage,
            disabled: !selectedAssetUrl,
        },
        {
            num: "3D",
            title: "查詢與聚焦模型節點",
            route: "viewer <-> bim-streaming-server",
            status: hasStreamResponse ? "已有回應" : "可操作",
            statusKind: hasStreamResponse ? "ok" : hasStreamCommand ? "warn" : "idle",
            description: "示範使用者要求 Kit runtime 回傳 stage tree，或把 camera 聚焦到 /World。",
            effect: "觀察效果：DataChannel received 會出現 getChildrenResponse / focusPrimResult 等 runtime 回饋。",
            actionLabel: "查詢 /World 節點",
            action: onGetChildren,
        },
        {
            num: "ISS",
            title: "高亮問題元件",
            route: "viewer -> DataChannel / coordinator broadcast",
            status: hasStreamResponse ? "可驗證" : "等待 Kit 回應",
            statusKind: hasStreamResponse ? "ok" : hasStreamCommand ? "warn" : "idle",
            description: "把 issue 對應的 prim path 轉成 3D 高亮，讓審查者看到問題位置。",
            effect: "觀察效果：DataChannel sent / received 會出現 highlightPrimsRequest / highlightPrimsResult。",
            actionLabel: "高亮示範問題",
            action: onHighlightWorld,
        },
        {
            num: "COL",
            title: "廣播協作事件",
            route: "viewer -> coordinator -> other viewers",
            status: socketEvents.length > 0 ? "已有事件" : "可操作",
            statusKind: socketEvents.length > 0 ? "ok" : sessionId ? "warn" : "idle",
            description: "模擬審查人員把問題焦點同步給其他瀏覽器，而不是只改自己的畫面。",
            effect: `觀察效果：Socket.IO events 最近一筆為「${latestSocketEvent}」。`,
            actionLabel: "送出 highlightRequest 廣播",
            action: onEmitCoordinatorHighlight,
            disabled: !sessionId,
        },
        {
            num: "REC",
            title: "建立標註並準備回寫",
            route: "viewer -> coordinator -> callback outbox",
            status: sessionId ? "可操作" : "需 session",
            statusKind: sessionId ? "warn" : "idle",
            description: "把審查意見寫成 annotation event，讓 Step ⑤ 可以看到 fake review metadata 回寫。",
            effect: "觀察效果：Socket.IO events 會出現 annotationCreate / ack；Step ⑤ 會以本場 session id 開啟。",
            actionLabel: "建立審查標註",
            action: onCreateAnnotation,
            disabled: !sessionId,
        },
        {
            num: "GAP",
            title: "轉檔與 storage 寫入缺口",
            route: "viewer -> coordinator console",
            status: hasArtifactUrlEvidence ? "前置已完成" : "需先轉檔",
            statusKind: hasArtifactUrlEvidence ? "ok" : "warn",
            description: "viewer 只消費已完成的 artifact refs；IFC-ready 與 conversion job 由 coordinator/streaming flow 負責。",
            effect: "觀察效果：完成 streaming 轉檔後，review session 的 artifact_bindings 會帶入 model/mapping URL。",
            actionLabel: "開啟 coordinator console",
            action: () => window.open("http://127.0.0.1:8004/dev-console", "_blank", "noopener,noreferrer"),
            gap: hasArtifactUrlEvidence ? undefined : "請先完成步驟 ①/②。",
        },
    ];

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
                        href={s.num === "⑤" ? recordHref : s.href}
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

                {/* Conversion summary card (additive read-only pass-through) */}
                <ConversionSummaryCard
                    streamConfig={streamConfig}
                    smokeBlockerHint={smokeBlockerHint ?? null}
                    fetchFallback={conversionSummaryFetchFallback}
                />

                {/* Architecture and repo ownership guide */}
                <div style={sectionStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                        <strong style={{ fontSize: 14 }}>架構導覽 (Repo map)</strong>
                        <span style={protocolPillStyle}>圖片 ①-⑥</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--demo-text-secondary)", marginBottom: 10 }}>
                        這裡把示意圖中的六個節點轉成可追蹤狀態，讓 demo 操作時能看見誰負責資料、誰負責檔案、誰負責 stream。
                    </div>
                    {repoGuideCards.map((card) => (
                        <RepoGuideCardView key={card.num} card={card} />
                    ))}
                </div>

                {/* End-to-end demo script */}
                <div style={sectionStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                        <strong style={{ fontSize: 14 }}>Demo 流程 (Data flow)</strong>
                        <span style={protocolPillStyle}>可操作 + 未完成</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--demo-text-secondary)", marginBottom: 10 }}>
                        依照流程按下按鈕，就能把 REST、artifact URL、Socket.IO、WebRTC / DataChannel 的資料流串起來。
                    </div>
                    {demoFlowSteps.map((step, index) => (
                        <DemoFlowStepView key={step.num} step={step} showConnector={index < demoFlowSteps.length - 1} />
                    ))}
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
                        ▸ 展開互動實驗室與技術細節 (Interaction lab + technical details)
                    </summary>
                    <div style={{ marginTop: 10 }}>
                        <div
                            style={{
                                padding: 10,
                                border: "1px solid var(--demo-border)",
                                borderRadius: "var(--demo-radius)",
                                background: "var(--demo-bg-card)",
                                color: "var(--demo-text-secondary)",
                                fontSize: 12,
                            }}
                        >
                            <strong style={{ display: "block", color: "var(--demo-text-primary)", marginBottom: 4 }}>
                                互動效果實驗室
                            </strong>
                            這裡用業務語言包住 REST、Socket.IO 與 DataChannel。按下每個動作後，先看左側 3D 畫面，再看下方觀察視窗，就能理解資料流和 repo 邊界。
                        </div>

                        <div
                            style={{
                                display: "grid",
                                gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
                                gap: 6,
                                marginTop: 8,
                            }}
                        >
                            <ViewerSignal label="最近送出" value={latestOutgoingLabel} />
                            <ViewerSignal label="最近回應" value={latestIncomingLabel} />
                            <ViewerSignal label="最近協作事件" value={latestSocketEvent} />
                        </div>

                        <div style={labGridStyle}>
                            {interactionLabCards.map((card) => (
                                <InteractionLabCardView key={`${card.num}-${card.title}`} card={card} />
                            ))}
                        </div>

                        <details
                            style={{
                                marginTop: 10,
                                padding: "10px 10px 8px",
                                border: "1px solid var(--demo-border)",
                                borderRadius: "var(--demo-radius)",
                                background: "var(--demo-bg)",
                            }}
                        >
                            <summary style={rawSummaryStyle}>工程 Raw logs / API controls</summary>
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
                <a href={recordHref} target="_blank" rel="noreferrer" style={{ color: "var(--demo-brand)", textDecoration: "none", fontWeight: 500 }}>
                    下一步 → 紀錄回寫 (⑤)
                </a>
            </div>
        </div>
    );
}

function ViewerSignal({ label, value }: { label: string; value: string }) {
    return (
        <div
            style={{
                minWidth: 0,
                padding: 8,
                border: "1px solid var(--demo-border)",
                borderRadius: "var(--demo-radius)",
                background: "var(--demo-bg-elevated)",
            }}
        >
            <div style={{ fontSize: 10, color: "var(--demo-text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>
                {label}
            </div>
            <div
                style={{
                    marginTop: 4,
                    color: "var(--demo-text-primary)",
                    fontSize: 11,
                    fontFamily: "var(--demo-font-mono)",
                    wordBreak: "break-word",
                }}
            >
                {value}
            </div>
        </div>
    );
}

function InteractionLabCardView({ card }: { card: InteractionLabCard }) {
    return (
        <div style={labCardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
                    <span
                        style={{
                            flex: "0 0 auto",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            minWidth: 28,
                            height: 24,
                            padding: "0 6px",
                            borderRadius: 999,
                            background: "var(--demo-brand)",
                            color: "#fff",
                            fontSize: 11,
                            fontWeight: 700,
                        }}
                    >
                        {card.num}
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <strong style={{ display: "block", fontSize: 12, color: "var(--demo-text-primary)" }}>{card.title}</strong>
                        <span style={{ display: "block", color: "var(--demo-text-secondary)", fontSize: 11, wordBreak: "break-word" }}>
                            {card.route}
                        </span>
                    </div>
                </div>
                <span className={`demo-status demo-status--${card.statusKind}`} style={{ flex: "0 0 auto", fontSize: 11 }}>
                    {card.status}
                </span>
            </div>
            <div style={{ marginTop: 8, color: "var(--demo-text-secondary)", fontSize: 12 }}>{card.description}</div>
            <div style={labEffectStyle}>{card.effect}</div>
            {card.gap && <div style={labGapStyle}>未完成標示：{card.gap}</div>}
            <button
                type="button"
                style={{
                    ...secondaryBtn,
                    marginTop: 8,
                    marginBottom: 0,
                    opacity: card.disabled ? 0.55 : 1,
                }}
                onClick={card.action}
                disabled={card.disabled}
            >
                {card.actionLabel}
            </button>
        </div>
    );
}

function RepoGuideCardView({ card }: { card: RepoGuideCard }) {
    return (
        <div style={guideCardStyle}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, minWidth: 0 }}>
                    <span
                        style={{
                            flex: "0 0 auto",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            background: "var(--demo-brand)",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                        }}
                    >
                        {card.num}
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--demo-text-primary)", overflowWrap: "anywhere" }}>
                            {card.repo}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--demo-text-secondary)", marginTop: 2 }}>
                            {card.role}
                        </div>
                    </div>
                </div>
                <span className={`demo-status demo-status--${card.statusKind}`} style={{ flex: "0 0 auto", fontSize: 11, padding: "3px 8px" }}>
                    {card.status}
                </span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 7 }}>
                <span style={protocolPillStyle}>{card.protocol}</span>
                <span style={{ fontSize: 11, color: "var(--demo-text-muted)" }}>{card.owns}</span>
            </div>
            <span style={miniLabelStyle}>{card.evidence}</span>
            {card.gap && (
                <div
                    style={{
                        marginTop: 7,
                        padding: 7,
                        borderLeft: "3px solid var(--demo-status-warn)",
                        background: "var(--demo-status-warn-soft)",
                        color: "var(--demo-text-secondary)",
                        fontSize: 11,
                    }}
                >
                    {card.gap}
                </div>
            )}
        </div>
    );
}

function DemoFlowStepView({ step, showConnector }: { step: DemoFlowStep; showConnector: boolean }) {
    const isDisabled = !!step.disabled || !step.action;
    return (
        <div>
            <div style={{ display: "grid", gridTemplateColumns: "26px minmax(0, 1fr)", gap: 8, alignItems: "start" }}>
                <span
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 24,
                        height: 24,
                        borderRadius: "50%",
                        border: "1px solid var(--demo-border-strong)",
                        background: "var(--demo-bg-elevated)",
                        color: "var(--demo-text-primary)",
                        fontSize: 12,
                        fontWeight: 700,
                    }}
                >
                    {step.num}
                </span>
                <div style={{ minWidth: 0, paddingBottom: showConnector ? 8 : 0 }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <strong style={{ fontSize: 13, overflowWrap: "anywhere" }}>{step.title}</strong>
                        <span className={`demo-status demo-status--${step.statusKind}`} style={{ flex: "0 0 auto", fontSize: 11, padding: "3px 8px" }}>
                            {step.status}
                        </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <span style={protocolPillStyle}>{step.protocol}</span>
                        <span style={{ fontSize: 11, color: "var(--demo-text-muted)", overflowWrap: "anywhere" }}>{step.route}</span>
                    </div>
                    {step.gap && (
                        <div
                            style={{
                                marginTop: 7,
                                padding: 7,
                                borderLeft: "3px solid var(--demo-status-warn)",
                                background: "var(--demo-status-warn-soft)",
                                color: "var(--demo-text-secondary)",
                                fontSize: 11,
                            }}
                        >
                            {step.gap}
                        </div>
                    )}
                    {step.actionLabel && (
                        <button
                            type="button"
                            style={flowButtonStyle(isDisabled)}
                            onClick={step.action}
                            disabled={isDisabled}
                        >
                            {step.actionLabel}
                        </button>
                    )}
                </div>
            </div>
            {showConnector && (
                <div style={{ margin: "0 0 2px 12px", height: 12, borderLeft: "1px solid var(--demo-border-strong)" }} />
            )}
        </div>
    );
}

function flowButtonStyle(disabled: boolean): React.CSSProperties {
    return {
        marginTop: 7,
        width: "100%",
        padding: "7px 9px",
        borderRadius: "var(--demo-radius)",
        border: disabled ? "1px solid var(--demo-border)" : "1px solid var(--demo-border-strong)",
        background: disabled ? "var(--demo-bg-elevated)" : "var(--demo-bg-card)",
        color: disabled ? "var(--demo-text-muted)" : "var(--demo-text-primary)",
        cursor: disabled ? "not-allowed" : "pointer",
        textAlign: "left",
        fontSize: 12,
        fontWeight: 600,
    };
}

function withSessionId(href: string, sessionId: string | null): string {
    if (!sessionId) return href;
    const url = new URL(href);
    url.searchParams.set("sessionId", sessionId);
    return url.toString();
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
