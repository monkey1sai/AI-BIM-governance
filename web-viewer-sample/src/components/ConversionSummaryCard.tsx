// ConversionSummaryCard — additive, read-only pass-through of `_worker` conversion metrics.
// The viewer MUST NOT compute, cache, or rebroadcast these values; the card only renders what the
// coordinator forwards inside `stream_config.quality_metrics_summary`, or in dev builds, what the
// worker `/api/conversions/{job}/result` endpoint returns. Production builds (`import.meta.env.PROD`)
// MUST NOT reach the dev fallback. See openspec/changes/stabilize-demo-runtime-readiness §8.

import { useEffect, useRef, useState } from "react";
import type React from "react";
import type { ConversionQualityMetricsSummary, ReviewStreamConfig } from "../types/review";

export interface SmokeBlockerHint {
    blocker?: string | null;
    next_command?: string | null;
}

export interface ConversionSummaryCardProps {
    streamConfig: ReviewStreamConfig | null;
    smokeBlockerHint?: SmokeBlockerHint | null;
    /**
     * Optional dev-only fallback fetcher. When omitted, the default fetch path is `fetch` against
     * the worker URL (only invoked when `import.meta.env.DEV` is true). Injecting allows
     * deterministic testing via `verify-conversion-summary-card.mjs`.
     */
    fetchFallback?: (conversionJobId: string) => Promise<ConversionQualityMetricsSummary | null>;
    /**
     * Override for the worker base URL. Defaults to `http://127.0.0.1:8005`. Production
     * builds (`import.meta.env.PROD`) MUST NOT reach the fallback regardless of this value.
     */
    workerBaseUrl?: string;
}

const cardStyle: React.CSSProperties = {
    background: "var(--demo-bg-card)",
    border: "1px solid var(--demo-border)",
    borderRadius: "var(--demo-radius-lg)",
    padding: 14,
    marginBottom: 12,
    boxShadow: "0 1px 2px rgba(16,42,67,0.08)",
};

const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    color: "var(--demo-text-muted)",
    textTransform: "uppercase",
    fontWeight: 700,
};

const valueStyle: React.CSSProperties = {
    display: "block",
    marginTop: 3,
    fontSize: 13,
    color: "var(--demo-text-primary)",
    fontFamily: "var(--demo-font-mono)",
    wordBreak: "break-word",
};

const gridStyle: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 10,
    marginTop: 10,
};

const degradedStyle: React.CSSProperties = {
    marginTop: 8,
    padding: 10,
    borderLeft: "3px solid var(--demo-status-warn)",
    background: "var(--demo-status-warn-soft)",
    color: "var(--demo-text-secondary)",
    fontSize: 12,
};

function isDevEnvironment(): boolean {
    // Vite-only signal. In Node/test environments (e.g. verify-conversion-summary-card.mjs) the
    // injected mock fetcher is what actually runs — the DEV flag is checked, but the fetch itself
    // is hooked, so production builds never reach the network.
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const meta: any = (import.meta as unknown as { env?: Record<string, unknown> }).env;
        if (meta && typeof meta.DEV === "boolean") {
            return Boolean(meta.DEV);
        }
        if (meta && typeof meta.VITE_ENABLE_WORKER_FETCH === "string") {
            return meta.VITE_ENABLE_WORKER_FETCH === "true";
        }
    } catch {
        // ignore — production builds with no import.meta available stay in non-dev.
    }
    return false;
}

async function defaultFetchFallback(
    workerBaseUrl: string,
    conversionJobId: string,
): Promise<ConversionQualityMetricsSummary | null> {
    const response = await fetch(`${workerBaseUrl}/api/conversions/${encodeURIComponent(conversionJobId)}/result`);
    if (!response.ok) {
        return null;
    }
    const result = await response.json();
    if (!result || typeof result !== "object") {
        return null;
    }
    const quality = (result.quality_metrics as Record<string, unknown> | undefined) ?? {};
    const phaseTimings = (quality.phase_timings as Record<string, unknown> | undefined) ?? {};
    const conversionTotal = (phaseTimings.conversion_total as Record<string, unknown> | undefined) ?? {};
    return {
        fixture_name: typeof result.original_filename === "string" ? result.original_filename : null,
        conversion_job_id: conversionJobId,
        artifact_group_id: typeof result.artifact_group_id === "string" ? result.artifact_group_id : null,
        source_ifc_entity_count: typeof quality.source_ifc_entity_count === "number" ? quality.source_ifc_entity_count : null,
        sidecar_carrier_count: typeof quality.sidecar_carrier_count === "number" ? quality.sidecar_carrier_count : null,
        materialization_strategy: typeof quality.materialization_strategy === "string" ? quality.materialization_strategy : null,
        coverage_ratio: typeof quality.coverage_ratio === "number" ? quality.coverage_ratio : null,
        coverage_status: typeof quality.coverage_status === "string" ? quality.coverage_status : null,
        conversion_duration_seconds:
            typeof conversionTotal.duration_seconds === "number" ? conversionTotal.duration_seconds : null,
    };
}

function pickConversionJobId(streamConfig: ReviewStreamConfig | null): string | null {
    if (!streamConfig) return null;
    if (streamConfig.model.conversion_job_id) return streamConfig.model.conversion_job_id;
    const summary = streamConfig.quality_metrics_summary;
    if (summary?.conversion_job_id) return summary.conversion_job_id;
    return null;
}

function formatNumber(value: number | null | undefined, fractionDigits = 0): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return value.toLocaleString(undefined, { maximumFractionDigits: fractionDigits, minimumFractionDigits: 0 });
}

function formatRatio(value: number | null | undefined): string {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    return value.toFixed(4);
}

function formatString(value: string | null | undefined): string {
    if (typeof value !== "string" || value.length === 0) return "—";
    return value;
}

export default function ConversionSummaryCard(props: ConversionSummaryCardProps) {
    const { streamConfig, smokeBlockerHint, fetchFallback, workerBaseUrl } = props;
    const modelStatus = streamConfig?.model.status ?? null;
    const isReady = modelStatus === "ready";
    const conversionAuthority = streamConfig?.model.conversion_authority ?? null;
    const stageComposition = streamConfig?.stage_composition ?? null;
    const summaryFromConfig = streamConfig?.quality_metrics_summary ?? null;
    const conversionJobId = pickConversionJobId(streamConfig);
    const dev = isDevEnvironment();

    const [fallbackSummary, setFallbackSummary] = useState<ConversionQualityMetricsSummary | null>(null);
    const [fallbackStatus, setFallbackStatus] = useState<"idle" | "loading" | "failed">("idle");
    const lastFetchedJobId = useRef<string | null>(null);

    useEffect(() => {
        // Only fetch in dev when:
        //  - model is ready,
        //  - coordinator did not forward quality_metrics_summary,
        //  - a conversion_job_id is available,
        //  - we haven't already fetched for this job.
        // Production builds MUST NOT enter this branch. The viewer never caches across sessions.
        if (!dev) return;
        if (!isReady) return;
        if (summaryFromConfig) return;
        if (!conversionJobId) return;
        if (lastFetchedJobId.current === conversionJobId) return;

        let cancelled = false;
        const runner = fetchFallback ?? ((jobId: string) => defaultFetchFallback(workerBaseUrl ?? "http://127.0.0.1:8005", jobId));
        setFallbackStatus("loading");
        lastFetchedJobId.current = conversionJobId;
        runner(conversionJobId)
            .then((result) => {
                if (cancelled) return;
                if (result) {
                    setFallbackSummary(result);
                    setFallbackStatus("idle");
                } else {
                    setFallbackSummary(null);
                    setFallbackStatus("failed");
                }
            })
            .catch(() => {
                if (cancelled) return;
                setFallbackSummary(null);
                setFallbackStatus("failed");
            });
        return () => {
            cancelled = true;
        };
    }, [dev, isReady, summaryFromConfig, conversionJobId, fetchFallback, workerBaseUrl]);

    const summary = summaryFromConfig ?? fallbackSummary ?? null;
    const showReady = isReady && summary;

    return (
        <div style={cardStyle} data-testid="conversion-summary-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <strong style={{ fontSize: 14 }}>轉檔品質摘要 (Conversion summary)</strong>
                <span className={`demo-status demo-status--${showReady ? "ok" : isReady ? "warn" : "idle"}`}>
                    {showReady ? "已就緒" : isReady ? "查詢中" : "尚未就緒"}
                </span>
            </div>

            {showReady ? (
                <div style={gridStyle} data-testid="conversion-summary-card-ready">
                    <Field label="Fixture name" value={formatString(summary.fixture_name)} />
                    <Field label="Source IFC entity count" value={formatNumber(summary.source_ifc_entity_count)} />
                    <Field label="Sidecar carrier count" value={formatNumber(summary.sidecar_carrier_count)} />
                    <Field label="Materialization strategy" value={formatString(summary.materialization_strategy)} />
                    <Field label="Coverage ratio" value={formatRatio(summary.coverage_ratio)} />
                    <Field label="Coverage status" value={formatString(summary.coverage_status)} />
                    <Field
                        label="Conversion duration (s)"
                        value={formatNumber(summary.conversion_duration_seconds, 3)}
                    />
                    {summary.conversion_job_id && (
                        <Field label="Conversion job id" value={formatString(summary.conversion_job_id)} />
                    )}
                    <Field label="Conversion authority" value={formatString(conversionAuthority)} />
                    <Field label="Primary artifact" value={formatString(stageComposition?.primary_artifact_id)} />
                    <Field
                        label="Secondary layers"
                        value={formatNumber(stageComposition?.secondary_artifact_ids?.length ?? null)}
                    />
                </div>
            ) : (
                <div style={degradedStyle} data-testid="conversion-summary-card-degraded">
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        Model status：<span style={{ fontFamily: "var(--demo-font-mono)" }}>{modelStatus ?? "unknown"}</span>
                    </div>
                    <Field label="Conversion authority" value={formatString(conversionAuthority)} />
                    <Field label="Conversion job id" value={formatString(conversionJobId)} />
                    <Field label="Failure code" value={formatString(streamConfig?.model.failure_code)} />
                    <Field label="Diagnostic" value={formatString(streamConfig?.model.diagnostic)} />
                    {smokeBlockerHint?.blocker && (
                        <div style={{ marginBottom: 4 }}>
                            <span style={labelStyle}>Smoke blocker</span>
                            <span style={valueStyle}>{smokeBlockerHint.blocker}</span>
                        </div>
                    )}
                    {smokeBlockerHint?.next_command && (
                        <div style={{ marginBottom: 4 }}>
                            <span style={labelStyle}>Next command</span>
                            <span style={valueStyle}>{smokeBlockerHint.next_command}</span>
                        </div>
                    )}
                    {!smokeBlockerHint?.blocker && !smokeBlockerHint?.next_command && (
                        <div>
                            Worker conversion is not ready yet. Re-run{" "}
                            <code>scripts/run-single-kit-demo.ps1</code> once the canonical fixture is converted.
                        </div>
                    )}
                    {dev && conversionJobId && fallbackStatus === "loading" && (
                        <div style={{ marginTop: 6 }} data-testid="conversion-summary-card-fetching">
                            Dev fallback：fetching `/api/conversions/{conversionJobId}/result`…
                        </div>
                    )}
                    {dev && conversionJobId && fallbackStatus === "failed" && (
                        <div style={{ marginTop: 6 }} data-testid="conversion-summary-card-fetch-failed">
                            Dev fallback fetch failed; coordinator forwarding is the source of truth.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <span style={labelStyle}>{label}</span>
            <span style={valueStyle}>{value}</span>
        </div>
    );
}
