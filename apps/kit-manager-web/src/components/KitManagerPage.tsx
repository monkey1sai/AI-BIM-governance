import { useEffect, useMemo, useState } from "react";
import { KitManagerClient } from "../api/KitManagerClient";
import { HealthResponse, KitInstanceState, UsdcArtifact } from "../models";
import { StatusPanel } from "./StatusPanel";
import { UsdcChecklist } from "./UsdcChecklist";

export function KitManagerPage() {
  // Browser traffic must enter via the coordinator proxy; :8010 remains an
  // internal kit-manager-api listener and is never a browser-facing fallback.
  const apiBase = import.meta.env.VITE_COORDINATOR_API_BASE || "http://127.0.0.1:8004";
  const viewerUrl = import.meta.env.VITE_VIEWER_URL || "http://127.0.0.1:5173";
  const client = useMemo(() => new KitManagerClient(apiBase), [apiBase]);
  const [artifacts, setArtifacts] = useState<UsdcArtifact[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [health, setHealth] = useState<HealthResponse>();
  const [state, setState] = useState<KitInstanceState>();
  const [operatorToken, setOperatorToken] = useState("");
  const [message, setMessage] = useState("尚未連線。");

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh() {
    try {
      const [runtimeHealth, items, current] = await Promise.all([
        client.getHealth(),
        client.listUsdc(),
        client.getCurrentInstance(),
      ]);
      setHealth(runtimeHealth);
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
    try {
      const response = await client.openSelected(Array.from(selected), operatorToken);
      setState(response.instance);
      setMessage(response.message);
    } catch (error) {
      setMessage(`Open 失敗：${String(error)}`);
    }
  }

  async function closeInstance() {
    try {
      const response = await client.closeInstance(operatorToken);
      setState(response.instance);
      setSelected(new Set());
      setMessage(response.message);
    } catch (error) {
      setMessage(`Close 失敗：${String(error)}`);
    }
  }

  return (
    <main className="page">
      <header>
        <p className="eyebrow">AI-BIM Runtime Manager</p>
        <h1>Kit 管理前端</h1>
        <p>Docker-first MVP：選擇 k 個 USDC，對單一 GPU Kit instance 執行開啟 / 關閉。</p>
      </header>

      <section className="actions">
        <label className="operator-token">
          Operator token
          <input
            type="password"
            value={operatorToken}
            onChange={(event) => setOperatorToken(event.target.value)}
            autoComplete="off"
            aria-label="Operator token"
          />
        </label>
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
        <StatusPanel health={health} state={state} message={message} />
      </section>
    </main>
  );
}
