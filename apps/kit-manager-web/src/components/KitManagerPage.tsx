import { useEffect, useMemo, useState } from "react";
import { KitManagerClient } from "../api/KitManagerClient";
import { KitInstanceState, UsdcArtifact } from "../models";
import { StatusPanel } from "./StatusPanel";
import { UsdcChecklist } from "./UsdcChecklist";

export function KitManagerPage() {
  const apiBase = import.meta.env.VITE_KIT_MANAGER_API_BASE || "http://127.0.0.1:8010";
  const viewerUrl = import.meta.env.VITE_VIEWER_URL || "http://127.0.0.1:5173";
  const client = useMemo(() => new KitManagerClient(apiBase), [apiBase]);
  const [artifacts, setArtifacts] = useState<UsdcArtifact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [state, setState] = useState<KitInstanceState>();
  const [message, setMessage] = useState("尚未連線。");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const [items, current] = await Promise.all([client.listUsdc(), client.getCurrentInstance()]);
      setArtifacts(items);
      setState(current);
      setMessage("Kit Manager API 已連線。");
    } catch (error) {
      setMessage(`連線失敗：${String(error)}`);
    }
  }

  function toggle(artifactId: string) {
    const next = new Set(selected);
    next.has(artifactId) ? next.delete(artifactId) : next.add(artifactId);
    setSelected(next);
  }

  async function openSelected() {
    if (selected.size === 0) {
      setMessage("請先選擇至少一個 .usdc 檔案。");
      return;
    }
    const response = await client.openSelected(Array.from(selected));
    setState(response.instance);
    setMessage(response.message);
  }

  async function closeInstance() {
    const response = await client.closeInstance();
    setState(response.instance);
    setSelected(new Set());
    setMessage(response.message);
  }

  return (
    <main className="page">
      <header>
        <p className="eyebrow">AI-BIM Runtime Manager</p>
        <h1>Kit 管理前端</h1>
        <p>Docker-first MVP：選擇 k 個 USDC，對單一 GPU Kit instance 執行開啟 / 關閉。</p>
      </header>

      <section className="actions">
        <button onClick={refresh}>重新整理</button>
        <button onClick={openSelected}>Open selected in Kit</button>
        <button onClick={closeInstance}>Close instance</button>
        <a className="button" href={viewerUrl} target="_blank" rel="noreferrer">Open Viewer</a>
      </section>

      <section className="grid">
        <section className="panel">
          <h2>USDC 檔案</h2>
          <UsdcChecklist artifacts={artifacts} selected={selected} onToggle={toggle} />
        </section>
        <StatusPanel state={state} message={message} />
      </section>
    </main>
  );
}
