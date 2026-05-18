import { HealthResponse, KitInstanceState } from "../models";

interface Props {
  health?: HealthResponse;
  state?: KitInstanceState;
  message: string;
}

interface StatusView {
  key: string;
  tone: "ok" | "blocked" | "failed" | "neutral";
  text: string;
}

function classifyState(state?: KitInstanceState): StatusView {
  if (!state) {
    return {key: "core_runtime_unknown", tone: "neutral", text: "尚未取得 Kit Manager API 狀態。"};
  }
  if (state.status === "open") {
    return {key: "kit_opened", tone: "ok", text: "Kit open command 已由 control endpoint 接收。"};
  }
  if (state.status === "closed") {
    return {key: "kit_closed", tone: "ok", text: "Kit close command 已由 control endpoint 接收。"};
  }
  if (state.status === "blocked" && state.control_status === "blocked_gpu_runtime_unavailable") {
    return {key: "gpu_runtime_blocked", tone: "blocked", text: "GPU runtime 不可用，尚未形成 viewport pass。"};
  }
  if (state.status === "blocked" && state.control_status.startsWith("blocked")) {
    return {key: "kit_control_blocked", tone: "blocked", text: "只代表 runtime/control blocked，不代表 Docker build 或 GPU viewport pass。"};
  }
  if (state.status === "failed_linux_kit_build" || state.control_status === "failed_linux_kit_build") {
    return {key: "kit_build_failed", tone: "failed", text: "Linux Kit launcher 未由 Docker build 產生。"};
  }
  if (state.status === "recorded_only") {
    return {key: "recorded_only", tone: "neutral", text: "指令只被記錄，Kit 並未確認完成。"};
  }
  return {key: state.status, tone: "neutral", text: "狀態已記錄，但不是 MVP pass evidence。"};
}

export function StatusPanel({health, state, message}: Props) {
  const status = classifyState(state);

  return (
    <section className="panel">
      <h2>Kit Instance</h2>
      <p>{message}</p>
      {health && (
        <p className="status-line">
          <span className="badge ok">core_runtime_ok</span>
          <span>{health.runtime_mode} / host-local allowed: {String(health.host_local_runtime_allowed)}</span>
        </p>
      )}
      <p className="status-line">
        <span className={`badge ${status.tone}`}>{status.key}</span>
        <span>{status.text}</span>
      </p>
      {state && (
        <dl>
          <dt>Instance</dt>
          <dd>{state.instance_id}</dd>
          <dt>Status</dt>
          <dd>{state.status}</dd>
          <dt>Control</dt>
          <dd>{state.control_status}</dd>
          <dt>Opened USDC</dt>
          <dd>{state.opened_runtime_uris.length}</dd>
        </dl>
      )}
      <ul className="status-notes">
        <li><code>web_viewer_engine_contract_ok</code> 由 Docker image 的 Node 18 / npm 10 / engine-strict 驗證。</li>
        <li><code>kit_build_failed</code> 代表 Docker build 沒有產生 Linux launcher。</li>
        <li><code>gpu_runtime_blocked</code> 只限 GPU / NVIDIA runtime 等外部環境缺失。</li>
      </ul>
    </section>
  );
}
