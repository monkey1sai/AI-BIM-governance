// 本機未轉檔 IFC（契約 §5.1）：載入來源、註冊、輪詢。dev routes 關閉＝整段隱藏，不重試。
import { useCallback, useEffect, useRef, useState } from "react";
import { coordinatorClient, isDevRoutesDisabled, type IfcSource } from "../coordinatorClient";
import { INTAKE_MAX_ATTEMPTS, INTAKE_POLL_MS, classifyIntakeJob, type IntakeOutcome } from "./intakeProgress";

export type IntakeProgress = IntakeOutcome | { kind: "registering" } | { kind: "error"; message: string };

export interface IfcIntakeRegistration {
  sources: IfcSource[];
  devRoutes: "unknown" | "enabled" | "disabled";
  loadError: string | null;
  progress: Record<string, IntakeProgress>;
  loadSources(): Promise<void>;
  register(source: IfcSource): Promise<void>;
}

export function useIfcIntakeRegistration(onReady?: (sessionId: string) => void): IfcIntakeRegistration {
  const [sources, setSources] = useState<IfcSource[]>([]);
  const [devRoutes, setDevRoutes] = useState<IfcIntakeRegistration["devRoutes"]>("unknown");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, IntakeProgress>>({});
  const alive = useRef(true);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    alive.current = true; // StrictMode 的 mount→unmount→mount 會先把它設成 false；重掛時要復原，否則之後的回覆全被丟掉
    return () => { alive.current = false; for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); };
  }, []);

  const loadSources = useCallback(async () => {
    setLoadError(null);
    try {
      const response = await coordinatorClient.listIfcSources();
      if (!alive.current) return;
      setDevRoutes("enabled");
      setSources(response.items ?? []);
    } catch (error) {
      if (!alive.current) return;
      if (isDevRoutesDisabled(error)) { setDevRoutes("disabled"); setSources([]); return; }
      setDevRoutes("enabled");
      setLoadError(String(error));
    }
  }, []);
  useEffect(() => { void loadSources(); }, [loadSources]);

  const setOne = (sourceId: string, value: IntakeProgress) => setProgress((current) => ({ ...current, [sourceId]: value }));

  const poll = useCallback((sourceId: string, jobId: string, attempt: number) => {
    const timer = setTimeout(async () => {
      timers.current.delete(sourceId);
      try {
        const job = await coordinatorClient.getIfcReadyJob(jobId);
        if (!alive.current) return;
        const outcome = classifyIntakeJob(job, attempt, INTAKE_MAX_ATTEMPTS);
        setOne(sourceId, outcome);
        if (outcome.kind === "converting") poll(sourceId, jobId, attempt + 1);
        else if (outcome.kind === "ready" && outcome.sessionId) onReadyRef.current?.(outcome.sessionId);
      } catch (error) {
        if (!alive.current) return;
        // 單次輪詢失敗（網路抖動、coordinator 重啟）不代表轉檔失敗：與 RealIfcConsolePage 相同，繼續輪詢到次數用完（Ruling R16）。
        if (attempt < INTAKE_MAX_ATTEMPTS) { setOne(sourceId, { kind: "converting", status: "poll_error" }); poll(sourceId, jobId, attempt + 1); }
        else setOne(sourceId, { kind: "error", message: String(error) });
      }
    }, INTAKE_POLL_MS);
    timers.current.set(sourceId, timer);
  }, []);

  const register = useCallback(async (source: IfcSource) => {
    setOne(source.source_id, { kind: "registering" });
    const modelVersionId = `mv_realifc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    try {
      const reply = await coordinatorClient.registerIfcSource(source.source_id, { project_id: "project_real_ifc_demo", model_version_id: modelVersionId });
      if (!alive.current) return;
      if (!reply.ifc_ready_job_id) { setOne(source.source_id, { kind: "error", message: reply.error_code ?? "register_rejected" }); return; }
      const first = classifyIntakeJob(reply, 1);
      setOne(source.source_id, first);
      if (first.kind === "converting") poll(source.source_id, reply.ifc_ready_job_id, 2);
      else if (first.kind === "ready" && first.sessionId) onReadyRef.current?.(first.sessionId);
    } catch (error) {
      if (!alive.current) return;
      if (isDevRoutesDisabled(error)) { setDevRoutes("disabled"); setSources([]); setProgress({}); return; }
      setOne(source.source_id, { kind: "error", message: String(error) });
    }
  }, [poll]);

  return { sources, devRoutes, loadError, progress, loadSources, register };
}
