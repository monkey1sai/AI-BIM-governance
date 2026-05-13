from fastapi.responses import HTMLResponse


def render_worker_ui() -> HTMLResponse:
    return HTMLResponse(
        """
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Worker 上傳建模與自動轉換</title>
  <style>
    :root {
      --demo-bg: #f4f7fb;
      --demo-bg-elevated: #ffffff;
      --demo-bg-card: #eaf2fb;
      --demo-border: #c9d6e6;
      --demo-border-strong: #9fb3c8;
      --demo-text-primary: #102a43;
      --demo-text-secondary: #486581;
      --demo-text-muted: #829ab1;
      --demo-brand: #1d6fb8;
      --demo-brand-soft: #d6e8fa;
      --demo-brand-hover: #1357a3;
      --demo-status-ok: #2ea44f;
      --demo-status-ok-soft: #dcffe4;
      --demo-status-warn: #b08800;
      --demo-status-warn-soft: #fff4cc;
      --demo-status-bad: #d73a49;
      --demo-status-bad-soft: #ffe1e3;
      --demo-status-idle: #829ab1;
      --demo-font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans TC", "Microsoft JhengHei", sans-serif;
      --demo-font-mono: "JetBrains Mono", Consolas, "Courier New", monospace;
      --demo-radius: 8px;
      --demo-radius-lg: 12px;
    }

    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--demo-bg);
      color: var(--demo-text-primary);
      font-family: var(--demo-font-sans);
      font-size: 14px;
      line-height: 1.55;
    }

    .demo-header, .demo-stepbar, .demo-footer {
      background: var(--demo-bg-elevated);
      border-bottom: 1px solid var(--demo-border);
    }
    .demo-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      padding: 16px 24px;
    }
    .demo-header__brand { font-size: 16px; font-weight: 700; }
    .demo-header__step-label { color: var(--demo-text-secondary); font-size: 13px; }
    .demo-stepbar {
      display: flex;
      gap: 4px;
      padding: 12px 24px;
      overflow-x: auto;
    }
    .demo-stepbar__item {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: max-content;
      padding: 8px 12px;
      border-radius: var(--demo-radius);
      color: var(--demo-text-muted);
      text-decoration: none;
      font-size: 13px;
      white-space: nowrap;
    }
    .demo-stepbar__item:hover { background: var(--demo-brand-soft); color: var(--demo-text-secondary); }
    .demo-stepbar__item--active { background: var(--demo-brand-soft); color: var(--demo-text-primary); font-weight: 700; }
    .demo-stepbar__num {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      background: var(--demo-bg-card);
      border: 1px solid var(--demo-border);
      font-size: 12px;
    }
    .demo-stepbar__item--active .demo-stepbar__num {
      color: #fff;
      background: var(--demo-brand);
      border-color: var(--demo-brand);
    }

    .demo-main {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px;
    }
    .demo-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
      gap: 16px;
    }
    .demo-card {
      background: var(--demo-bg-card);
      border: 1px solid var(--demo-border);
      border-radius: var(--demo-radius-lg);
      padding: 20px;
      box-shadow: 0 1px 2px rgba(16,42,67,0.08);
    }
    .demo-card + .demo-card { margin-top: 16px; }
    h1, h2 { margin: 0 0 8px; }
    h1 { font-size: 21px; }
    h2 { font-size: 16px; }
    .demo-subtitle { margin: 0 0 16px; color: var(--demo-text-secondary); font-size: 13px; }
    .demo-status {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
    }
    .demo-status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .demo-status--ok { color: var(--demo-status-ok); background: var(--demo-status-ok-soft); }
    .demo-status--warn { color: var(--demo-status-warn); background: var(--demo-status-warn-soft); }
    .demo-status--bad { color: var(--demo-status-bad); background: var(--demo-status-bad-soft); }
    .demo-status--idle { color: var(--demo-status-idle); background: var(--demo-bg-elevated); }
    .source-list {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .source-row {
      width: 100%;
      text-align: left;
      border: 1px solid var(--demo-border);
      border-radius: var(--demo-radius);
      background: var(--demo-bg-elevated);
      padding: 12px;
      cursor: pointer;
      color: var(--demo-text-primary);
      font: inherit;
    }
    .source-row:hover, .source-row.is-selected {
      border-color: var(--demo-brand);
      background: var(--demo-brand-soft);
    }
    .source-row__title { font-weight: 700; overflow-wrap: anywhere; }
    .source-row__meta { color: var(--demo-text-muted); font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
    .demo-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 14px;
    }
    .demo-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 40px;
      padding: 9px 14px;
      border: 1px solid var(--demo-brand);
      border-radius: var(--demo-radius);
      background: var(--demo-brand);
      color: #fff;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
    }
    .demo-btn:hover { background: var(--demo-brand-hover); }
    .demo-btn:disabled {
      opacity: 0.52;
      cursor: not-allowed;
      background: var(--demo-bg-elevated);
      color: var(--demo-text-muted);
      border-color: var(--demo-border);
    }
    .demo-btn--secondary {
      background: var(--demo-bg-elevated);
      color: var(--demo-text-primary);
      border-color: var(--demo-border-strong);
    }
    .demo-kv {
      display: grid;
      grid-template-columns: 120px minmax(0, 1fr);
      gap: 7px 10px;
      margin-top: 12px;
      font-size: 13px;
    }
    .demo-kv dt { color: var(--demo-text-secondary); }
    .demo-kv dd { margin: 0; overflow-wrap: anywhere; font-family: var(--demo-font-mono); font-size: 12px; }
    .demo-empty, .demo-failure {
      padding: 12px;
      border-radius: var(--demo-radius);
      background: var(--demo-bg-elevated);
      border: 1px solid var(--demo-border);
      color: var(--demo-text-secondary);
      font-size: 13px;
    }
    .demo-failure { display: none; background: var(--demo-status-bad-soft); border-color: #f3a5ad; }
    .demo-failure.is-visible { display: block; }
    .lineage-list {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }
    .lineage-row {
      display: grid;
      grid-template-columns: 150px minmax(0, 1fr);
      gap: 6px 10px;
      padding: 10px 12px;
      border: 1px solid var(--demo-border);
      border-radius: var(--demo-radius);
      background: var(--demo-bg-elevated);
      font-size: 12px;
    }
    .lineage-row strong { color: var(--demo-text-primary); }
    .lineage-row span { color: var(--demo-text-secondary); overflow-wrap: anywhere; font-family: var(--demo-font-mono); }
    pre {
      margin: 12px 0 0;
      padding: 12px;
      background: #0e1116;
      color: #d6e2f0;
      border-radius: var(--demo-radius);
      overflow: auto;
      max-height: 260px;
      font-family: var(--demo-font-mono);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .demo-footer {
      border-top: 1px solid var(--demo-border);
      border-bottom: 0;
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 24px;
      color: var(--demo-text-secondary);
      font-size: 13px;
    }
    .demo-footer a { color: var(--demo-brand); text-decoration: none; font-weight: 700; }
    @media (max-width: 820px) {
      .demo-grid { grid-template-columns: 1fr; }
      .demo-header, .demo-footer { flex-direction: column; }
    }
  </style>
</head>
<body>
  <header class="demo-header">
    <div class="demo-header__brand">BIM 審查雲端 Demo｜Worker 上傳建模與自動轉換</div>
    <div class="demo-header__step-label">步驟 ① / ②</div>
  </header>

  <nav class="demo-stepbar" aria-label="Demo 流程">
    <a class="demo-stepbar__item demo-stepbar__item--active" href="http://127.0.0.1:8005" aria-current="step">
      <span class="demo-stepbar__num">①</span>上傳建模 (Upload)
    </a>
    <a class="demo-stepbar__item demo-stepbar__item--active" href="http://127.0.0.1:8005">
      <span class="demo-stepbar__num">②</span>自動轉換 (Convert)
    </a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8004">
      <span class="demo-stepbar__num">③</span>建立會議 (Meeting)
    </a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:5173">
      <span class="demo-stepbar__num">④</span>標記問題 (Mark)
    </a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8001">
      <span class="demo-stepbar__num">⑤</span>紀錄回寫 (Record)
    </a>
  </nav>

  <main class="demo-main">
    <div class="demo-grid">
      <section class="demo-card">
        <h1>選擇 IFC 來源 <span id="sourceStatus" class="demo-status demo-status--idle">讀取中</span></h1>
        <p class="demo-subtitle">Worker 只讀取本機 demo source root 內的 IFC，並在選取後建立 artifact 與 conversion job。</p>
        <div id="failure" class="demo-failure"></div>
        <div id="sourceList" class="source-list"></div>
        <div class="demo-actions">
          <button id="refreshBtn" class="demo-btn demo-btn--secondary" type="button">重新整理</button>
          <button id="convertBtn" class="demo-btn" type="button" disabled>開始轉換</button>
        </div>
      </section>

      <aside class="demo-card">
        <h2>目前狀態</h2>
        <p class="demo-subtitle">完成後會顯示 artifact group readiness，接著前往步驟 ③ 建立 review session。</p>
        <span id="jobStatus" class="demo-status demo-status--idle">尚未啟動</span>
        <dl class="demo-kv">
          <dt>selected</dt><dd id="selectedSource">—</dd>
          <dt>job</dt><dd id="jobId">—</dd>
          <dt>artifact group</dt><dd id="artifactGroupId">—</dd>
          <dt>readiness</dt><dd id="readiness">—</dd>
          <dt>coverage</dt><dd id="coverageRatio">—</dd>
          <dt>lineage</dt><dd id="lineageSummary">—</dd>
          <dt>USDC</dt><dd id="usdcUrl">—</dd>
          <dt>handoff</dt><dd id="reviewHandoff">—</dd>
        </dl>
        <div class="demo-actions">
          <a id="nextStep" class="demo-btn" href="http://127.0.0.1:8004" aria-disabled="true">前往建立會議</a>
          <a id="reviewPreview" class="demo-btn demo-btn--secondary" href="http://127.0.0.1:8004" aria-disabled="true">開啟 USDC Review</a>
        </div>
      </aside>
    </div>

    <section class="demo-card">
      <h2>Lineage / Quality <span id="lineageStatus" class="demo-status demo-status--idle">尚未查詢</span></h2>
      <p class="demo-subtitle">只顯示 worker API 回傳的 artifact lineage 與 coverage 狀態。</p>
      <div id="lineageNodes" class="demo-empty">尚未有完成的 conversion。</div>
      <div id="lineageDiagnostics" class="lineage-list"></div>
    </section>

    <section class="demo-card">
      <h2>技術回應</h2>
      <pre id="rawLog">尚未送出請求。</pre>
    </section>
  </main>

  <footer class="demo-footer">
    <span>你現在在這裡：步驟 ①/② Worker 檔案與轉檔邊界</span>
    <a href="http://127.0.0.1:8004">下一步：建立會議 (③)</a>
  </footer>

  <script>
    const sourceList = document.getElementById("sourceList");
    const sourceStatus = document.getElementById("sourceStatus");
    const failure = document.getElementById("failure");
    const rawLog = document.getElementById("rawLog");
    const convertBtn = document.getElementById("convertBtn");
    const refreshBtn = document.getElementById("refreshBtn");
    const selectedSourceEl = document.getElementById("selectedSource");
    const jobStatus = document.getElementById("jobStatus");
    const jobIdEl = document.getElementById("jobId");
    const artifactGroupEl = document.getElementById("artifactGroupId");
    const readinessEl = document.getElementById("readiness");
    const coverageRatioEl = document.getElementById("coverageRatio");
    const lineageSummaryEl = document.getElementById("lineageSummary");
    const usdcUrlEl = document.getElementById("usdcUrl");
    const reviewHandoffEl = document.getElementById("reviewHandoff");
    const lineageStatus = document.getElementById("lineageStatus");
    const lineageNodes = document.getElementById("lineageNodes");
    const lineageDiagnostics = document.getElementById("lineageDiagnostics");
    const nextStep = document.getElementById("nextStep");
    const reviewPreview = document.getElementById("reviewPreview");
    let sources = [];
    let selected = null;
    let pollTimer = null;

    refreshBtn.addEventListener("click", loadSources);
    convertBtn.addEventListener("click", startConversion);

    function setStatus(el, kind, label) {
      el.className = `demo-status demo-status--${kind}`;
      el.textContent = label;
    }

    function log(payload) {
      rawLog.textContent = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
    }

    async function fetchJson(path, init) {
      const response = await fetch(path, { headers: { Accept: "application/json", ...(init?.headers || {}) }, ...init });
      const text = await response.text();
      let body = null;
      try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
      if (!response.ok) {
        const message = body?.detail || response.statusText;
        throw new Error(`${response.status} ${message}`);
      }
      return body;
    }

    async function loadSources() {
      setStatus(sourceStatus, "warn", "讀取中");
      failure.classList.remove("is-visible");
      try {
        const body = await fetchJson("/api/dev/ifc-sources");
        sources = body.items || [];
        log(body);
        renderSources(body.root || {});
        setStatus(sourceStatus, sources.length ? "ok" : "idle", sources.length ? `${sources.length} 個 IFC` : "沒有 IFC");
      } catch (error) {
        sources = [];
        renderSources({});
        failure.textContent = String(error);
        failure.classList.add("is-visible");
        setStatus(sourceStatus, "bad", "讀取失敗");
      }
    }

    function renderSources(root) {
      if (!root.exists || !root.is_directory) {
        sourceList.innerHTML = '<div class="demo-empty">找不到 demo storage folder。請在 repo root 建立 storage/，並放入 .ifc 檔案。</div>';
        selected = null;
        updateSelection();
        return;
      }
      if (sources.length === 0) {
        sourceList.innerHTML = '<div class="demo-empty">目前沒有可選的 IFC。請把 .ifc 放進 repo root storage/ 後重新整理。</div>';
        selected = null;
        updateSelection();
        return;
      }
      sourceList.innerHTML = sources.map((item, index) => `
        <button class="source-row${selected?.source_id === item.source_id ? " is-selected" : ""}" type="button" data-index="${index}">
          <div class="source-row__title">${escapeHtml(item.filename)}</div>
          <div class="source-row__meta">${escapeHtml(item.relative_path)} · ${formatBytes(item.size_bytes)} · ${escapeHtml(item.modified_at)}</div>
        </button>
      `).join("");
      sourceList.querySelectorAll(".source-row").forEach((button) => {
        button.addEventListener("click", () => {
          selected = sources[Number(button.dataset.index)];
          updateSelection();
          renderSources(root);
        });
      });
      updateSelection();
    }

    function updateSelection() {
      selectedSourceEl.textContent = selected ? selected.relative_path : "—";
      convertBtn.disabled = !selected;
    }

    async function startConversion() {
      if (!selected) return;
      clearTimeout(pollTimer);
      setStatus(jobStatus, "warn", "建立 job");
      try {
        const body = await fetchJson(`/api/dev/ifc-sources/${encodeURIComponent(selected.source_id)}/conversions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tenant_id: "tenant_demo_001",
            project_id: "project_demo_001",
            model_version_id: "version_demo_001",
            source_system: "dev_storage",
            uploaded_by: "dev_user_001"
          })
        });
        log(body);
        jobIdEl.textContent = body.conversion_job_id || "—";
        artifactGroupEl.textContent = body.artifact_group_id || "—";
        setStatus(jobStatus, body.status === "succeeded" ? "ok" : "warn", body.status || "queued");
        if (body.conversion_job_id) pollConversion(body.conversion_job_id, body.artifact_group_id, 0);
      } catch (error) {
        setStatus(jobStatus, "bad", "啟動失敗");
        log(String(error));
      }
    }

    async function pollConversion(jobId, artifactGroupId, attempt) {
      try {
        const result = await fetchJson(`/api/conversions/${encodeURIComponent(jobId)}/result`);
        log(result);
        setStatus(jobStatus, result.status === "succeeded" ? "ok" : "warn", result.status || "running");
        if (result.status === "succeeded") {
          configureReviewHandoff(result, artifactGroupId);
          await loadLineage(result.usdc_artifact_id || result.source_artifact_id);
          await pollReadiness(artifactGroupId);
          return;
        }
        if (attempt >= 30) {
          setStatus(jobStatus, "bad", "逾時");
          return;
        }
        pollTimer = setTimeout(() => pollConversion(jobId, artifactGroupId, attempt + 1), 1000);
      } catch (error) {
        setStatus(jobStatus, "bad", "查詢失敗");
        log(String(error));
      }
    }

    async function pollReadiness(artifactGroupId) {
      const readiness = await fetchJson(`/api/artifact-groups/${encodeURIComponent(artifactGroupId)}/readiness`);
      readinessEl.textContent = readiness.ready_status || readiness.status || "—";
      coverageRatioEl.textContent = readiness.coverage_status || "—";
      if (readiness.ready_status === "ready") {
        nextStep.href = `http://127.0.0.1:8004?artifact_group_id=${encodeURIComponent(artifactGroupId)}&model_version_id=version_demo_001`;
        nextStep.setAttribute("aria-disabled", "false");
      }
    }

    function configureReviewHandoff(result, artifactGroupId) {
      const params = new URLSearchParams();
      params.set("artifact_group_id", artifactGroupId || result.artifact_group_id || "");
      params.set("model_version_id", result.model_version_id || "version_demo_001");
      params.set("conversion_job_id", result.conversion_job_id || "");
      params.set("source_artifact_id", result.source_artifact_id || "");
      params.set("usdc_artifact_id", result.usdc_artifact_id || "");
      params.set("usdc_url", result.usdc_url || "");
      params.set("mapping_url", result.mapping_url || "");
      const derived = result.derived_artifact_ids || {};
      if (derived.element_mapping) params.set("mapping_artifact_id", derived.element_mapping);
      const target = `http://127.0.0.1:8004?${params.toString()}`;
      usdcUrlEl.textContent = result.usdc_url || "—";
      reviewHandoffEl.textContent = result.usdc_url ? "bim-review-coordinator" : "—";
      if (result.usdc_url) {
        nextStep.href = target;
        nextStep.setAttribute("aria-disabled", "false");
        reviewPreview.href = target;
        reviewPreview.setAttribute("aria-disabled", "false");
      }
    }

    async function loadLineage(artifactId) {
      if (!artifactId) return;
      try {
        const lineage = await fetchJson(`/api/artifacts/${encodeURIComponent(artifactId)}/lineage`);
        const quality = lineage.quality_metrics_summary || {};
        const coverageStatus = quality.coverage_status || "unknown";
        const statusKind = coverageStatus === "fail" ? "bad" : coverageStatus === "warn" ? "warn" : "ok";
        setStatus(lineageStatus, statusKind, coverageStatus);
        coverageRatioEl.textContent = Number.isFinite(quality.coverage_ratio) ? quality.coverage_ratio.toFixed(4) : "—";
        lineageSummaryEl.textContent = `${lineage.nodes?.length || 0} nodes / ${lineage.edges?.length || 0} edges`;
        lineageNodes.className = "lineage-list";
        lineageNodes.innerHTML = (lineage.nodes || []).map((node) => `
          <div class="lineage-row">
            <strong>${escapeHtml(node.kind || node.role || "node")}</strong>
            <span>${escapeHtml(node.artifact_id || node.node_id || "—")}</span>
            <strong>url</strong>
            <span>${escapeHtml(node.url || "—")}</span>
          </div>
        `).join("") || '<div class="demo-empty">沒有 lineage nodes。</div>';
        lineageDiagnostics.innerHTML = (lineage.diagnostics || []).map((item) => `
          <div class="lineage-row">
            <strong>${escapeHtml(item.severity || "info")}</strong>
            <span>${escapeHtml(item.code || "diagnostic")}: ${escapeHtml(item.message || "")}</span>
          </div>
        `).join("");
      } catch (error) {
        setStatus(lineageStatus, "bad", "查詢失敗");
        lineageNodes.className = "demo-empty";
        lineageNodes.textContent = String(error);
        lineageDiagnostics.innerHTML = "";
      }
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes)) return "n/a";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    loadSources();
  </script>
</body>
</html>
        """
    )
