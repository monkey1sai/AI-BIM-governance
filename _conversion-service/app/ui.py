"""Demo UI for _conversion-service (step ② in the demo storyboard).

設計守則: docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md
跨服務 design tokens 權威來源: web-viewer-sample/src/styles/demo-theme.css
"""

from fastapi.responses import HTMLResponse


def render_ui() -> HTMLResponse:
    return HTMLResponse(
        """
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>模型轉換 (Model Conversion) — 步驟②</title>
  <style>
    :root {
      --demo-bg: #f4f7fb;
      --demo-bg-elevated: #ffffff;
      --demo-bg-card: #eaf2fb;
      --demo-bg-card-strong: #dbe9f7;
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
    body { background: var(--demo-bg); color: var(--demo-text-primary); font-family: var(--demo-font-sans); font-size: 14px; line-height: 1.55; }

    .demo-header { display: flex; align-items: center; justify-content: space-between; padding: 16px 24px; background: var(--demo-bg-elevated); border-bottom: 1px solid var(--demo-border); }
    .demo-header__brand { font-size: 16px; font-weight: 600; }
    .demo-header__step-label { font-size: 13px; color: var(--demo-text-secondary); }

    .demo-stepbar { display: flex; gap: 4px; padding: 12px 24px; background: var(--demo-bg-elevated); border-bottom: 1px solid var(--demo-border); overflow-x: auto; }
    .demo-stepbar__item { flex: 1; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-radius: var(--demo-radius); color: var(--demo-text-muted); text-decoration: none; font-size: 13px; white-space: nowrap; }
    .demo-stepbar__item:hover { background: var(--demo-brand-soft); color: var(--demo-text-secondary); }
    .demo-stepbar__item--active { background: var(--demo-brand-soft); color: var(--demo-text-primary); font-weight: 600; }
    .demo-stepbar__num { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 50%; background: var(--demo-bg-card); border: 1px solid var(--demo-border); font-size: 12px; }
    .demo-stepbar__item--active .demo-stepbar__num { background: var(--demo-brand); border-color: var(--demo-brand); color: #fff; }

    .demo-main { padding: 24px; max-width: 1200px; margin: 0 auto; }
    .demo-card { background: var(--demo-bg-card); border: 1px solid var(--demo-border); border-radius: var(--demo-radius-lg); padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 2px rgba(16,42,67,0.08); }
    .demo-card__title { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
    .demo-card__subtitle { font-size: 13px; color: var(--demo-text-secondary); margin: 0 0 16px; }

    .demo-status { display: inline-flex; align-items: center; gap: 8px; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 500; }
    .demo-status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .demo-status--ok   { color: var(--demo-status-ok);   background: var(--demo-status-ok-soft); }
    .demo-status--warn { color: var(--demo-status-warn); background: var(--demo-status-warn-soft); }
    .demo-status--bad  { color: var(--demo-status-bad);  background: var(--demo-status-bad-soft); }
    .demo-status--idle { color: var(--demo-status-idle); }

    .demo-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; background: var(--demo-brand); color: #fff; border: 1px solid var(--demo-brand); border-radius: var(--demo-radius); font: inherit; font-weight: 500; cursor: pointer; }
    .demo-btn:hover { background: var(--demo-brand-hover); }
    .demo-btn:disabled { background: var(--demo-bg-elevated); border-color: var(--demo-border); color: var(--demo-text-muted); cursor: not-allowed; }
    .demo-btn--secondary { background: transparent; color: var(--demo-text-primary); border-color: var(--demo-border-strong); }
    .demo-btn--secondary:hover { background: var(--demo-bg-elevated); }
    .demo-btn-caption { display: block; margin-top: 6px; font-size: 13px; color: var(--demo-text-secondary); }
    .demo-btn-caption::before { content: "↳ "; color: var(--demo-text-muted); }

    .demo-progress { width: 100%; height: 10px; background: var(--demo-bg-elevated); border: 1px solid var(--demo-border); border-radius: 999px; overflow: hidden; margin-top: 12px; }
    .demo-progress__bar { height: 100%; background: linear-gradient(90deg, var(--demo-brand), var(--demo-brand-hover)); transition: width 0.4s ease; width: 0; }

    .demo-stages { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; font-size: 13px; }
    .demo-stage { padding: 12px; background: var(--demo-bg-elevated); border: 1px solid var(--demo-border); border-radius: var(--demo-radius); color: var(--demo-text-muted); }
    .demo-stage__num { font-size: 11px; color: var(--demo-text-muted); }
    .demo-stage__name { font-weight: 600; margin-top: 4px; color: var(--demo-text-primary); }
    .demo-stage--done   { border-color: var(--demo-status-ok); background: var(--demo-status-ok-soft); color: var(--demo-status-ok); }
    .demo-stage--done .demo-stage__name { color: var(--demo-status-ok); }
    .demo-stage--active { border-color: var(--demo-brand); background: var(--demo-brand-soft); color: var(--demo-brand); }
    .demo-stage--active .demo-stage__name { color: var(--demo-brand); }

    .demo-result-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px; }
    .demo-result-item { padding: 12px 14px; background: var(--demo-bg-elevated); border: 1px solid var(--demo-border); border-radius: var(--demo-radius); }
    .demo-result-item__label { font-size: 12px; text-transform: uppercase; color: var(--demo-text-secondary); letter-spacing: 0.06em; }
    .demo-result-item__value { margin-top: 6px; word-break: break-all; }
    .demo-result-item__value a { color: var(--demo-brand); text-decoration: none; }
    .demo-result-item__value a:hover { text-decoration: underline; }

    .demo-details { margin-top: 24px; padding: 12px 16px; background: var(--demo-bg-elevated); border: 1px solid var(--demo-border); border-radius: var(--demo-radius); }
    .demo-details > summary { cursor: pointer; font-size: 13px; color: var(--demo-text-secondary); list-style: none; user-select: none; }
    .demo-details > summary::before { content: "▸ "; }
    .demo-details[open] > summary::before { content: "▾ "; }
    .demo-details__body { margin-top: 16px; }
    .demo-details__body label { display: block; margin: 10px 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--demo-text-secondary); }
    .demo-details__body input,
    .demo-details__body textarea { width: 100%; background: var(--demo-bg); color: var(--demo-text-primary); border: 1px solid var(--demo-border); border-radius: var(--demo-radius); padding: 8px; font: inherit; }
    .demo-details__body textarea { min-height: 180px; font-family: var(--demo-font-mono); font-size: 12px; }
    .demo-details button { display: inline-flex; margin: 4px 4px 0 0; padding: 6px 10px; background: var(--demo-bg); color: var(--demo-text-primary); border: 1px solid var(--demo-border-strong); border-radius: var(--demo-radius); font: inherit; font-size: 12px; cursor: pointer; }
    .demo-details button:hover { background: var(--demo-brand-soft); }
    .demo-details pre { margin: 12px 0 0; padding: 12px; background: #0e1116; color: #d6e2f0; border-radius: var(--demo-radius); font-family: var(--demo-font-mono); font-size: 12px; white-space: pre-wrap; word-break: break-word; max-height: 300px; overflow-y: auto; }

    .demo-failure { border-left: 3px solid var(--demo-status-bad); background: var(--demo-status-bad-soft); padding: 12px 16px; border-radius: var(--demo-radius); margin: 16px 0; display: none; }
    .demo-failure.is-visible { display: block; }
    .demo-failure__title { font-weight: 600; color: var(--demo-status-bad); margin-bottom: 4px; }
    .demo-failure__hint { color: var(--demo-text-secondary); font-size: 13px; font-family: var(--demo-font-mono); }

    .demo-footer-nav { display: flex; align-items: center; justify-content: space-between; margin-top: 24px; padding: 16px 24px; background: var(--demo-bg-elevated); border-top: 1px solid var(--demo-border); font-size: 13px; color: var(--demo-text-secondary); }
    .demo-footer-nav a { color: var(--demo-brand); text-decoration: none; font-weight: 500; }
    .demo-footer-nav a:hover { color: var(--demo-brand-hover); }
  </style>
</head>
<body>
  <header class="demo-header">
    <div class="demo-header__brand">BIM 審查雲端 Demo｜模型轉換 (Model Conversion)</div>
    <div class="demo-header__step-label">步驟 ② / 5</div>
  </header>

  <nav class="demo-stepbar" aria-label="Demo 流程">
    <a class="demo-stepbar__item" href="http://127.0.0.1:8002"><span class="demo-stepbar__num">①</span>上傳建模 (Upload)</a>
    <a class="demo-stepbar__item demo-stepbar__item--active" href="#" aria-current="step"><span class="demo-stepbar__num">②</span>自動轉換 (Convert)</a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8004"><span class="demo-stepbar__num">③</span>建立會議 (Meeting)</a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:5173"><span class="demo-stepbar__num">④</span>標記問題 (Mark)</a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8001"><span class="demo-stepbar__num">⑤</span>紀錄回寫 (Record)</a>
  </nav>

  <main class="demo-main">
    <section class="demo-card">
      <h1 class="demo-card__title">模型轉換服務狀態 <span id="convStatus" class="demo-status demo-status--idle">檢查中</span></h1>
      <p class="demo-card__subtitle">
        這個服務會把建築師上傳的原始建模檔 (例如 .ifc) 自動轉換成可在瀏覽器即時審查的 3D 模型 (.usdc)，
        並建立「元件對照表」，讓系統知道每個建築元件 (例如某根柱子) 對應到 3D 模型裡的哪個部位。
      </p>

      <div id="failure" class="demo-failure">
        <div class="demo-failure__title">轉檔服務未連線 (Conversion service offline)</div>
        <div class="demo-failure__hint">請在另一個終端機執行：cd _conversion-service &amp;&amp; uvicorn app.main:app --port 8003</div>
      </div>

      <button id="startBtn" class="demo-btn" type="button" onclick="startConversion()">
        開始轉換示範模型
        <span class="demo-btn-caption">系統會把雲端倉庫裡的原始建模檔轉成 3D 可審查模型 (約 30~60 秒)</span>
      </button>
    </section>

    <section class="demo-card">
      <h2 class="demo-card__title" style="font-size:16px;">轉換進度 <span id="jobStatus" class="demo-status demo-status--idle">尚未開始</span></h2>
      <div class="demo-progress"><div id="progressBar" class="demo-progress__bar"></div></div>

      <div class="demo-stages">
        <div id="stage-1" class="demo-stage">
          <div class="demo-stage__num">階段 1</div>
          <div class="demo-stage__name">讀取原始建模檔</div>
        </div>
        <div id="stage-2" class="demo-stage">
          <div class="demo-stage__num">階段 2</div>
          <div class="demo-stage__name">解析建築元件</div>
        </div>
        <div id="stage-3" class="demo-stage">
          <div class="demo-stage__num">階段 3</div>
          <div class="demo-stage__name">產出 3D 可審查模型</div>
        </div>
        <div id="stage-4" class="demo-stage">
          <div class="demo-stage__num">階段 4</div>
          <div class="demo-stage__name">建立元件對照表</div>
        </div>
      </div>

      <div id="resultGrid" class="demo-result-grid" style="display:none;">
        <div class="demo-result-item">
          <div class="demo-result-item__label">3D 可審查模型 (Reviewable model)</div>
          <div class="demo-result-item__value" id="usdcLink">—</div>
        </div>
        <div class="demo-result-item">
          <div class="demo-result-item__label">元件對照表 (Element mapping)</div>
          <div class="demo-result-item__value" id="mappingLink">—</div>
        </div>
      </div>
    </section>

    <details class="demo-details">
      <summary>展開技術細節 (Show technical details)</summary>
      <div class="demo-details__body">
        <label for="jobId">job_id</label>
        <input id="jobId" placeholder="conv_…" />

        <label for="jsonBody">POST /api/conversions request body</label>
        <textarea id="jsonBody">{
  "project_id": "project_demo_001",
  "model_version_id": "version_demo_001",
  "source_artifact_id": "artifact_ifc_demo_001",
  "source_url": "http://127.0.0.1:8002/static/projects/project_demo_001/versions/version_demo_001/source.ifc",
  "target_format": "usdc",
  "options": {
    "force": true,
    "generate_mapping": true,
    "allow_fake_mapping": false
  }
}</textarea>

        <h3 style="margin:16px 0 8px;font-size:13px;color:var(--demo-text-secondary);text-transform:uppercase;letter-spacing:0.06em;">Endpoints</h3>
        <button onclick="call('GET', '/health')">GET /health</button>
        <button onclick="createJobRaw()">POST /api/conversions</button>
        <button onclick="getJob()">GET /api/conversions/{job_id}</button>
        <button onclick="getResult()">GET /api/conversions/{job_id}/result</button>
        <button onclick="mockConversion()">POST /api/dev/mock-conversion-result</button>

        <h3 style="margin:16px 0 8px;font-size:13px;color:var(--demo-text-secondary);text-transform:uppercase;letter-spacing:0.06em;">Raw response</h3>
        <pre id="output">尚未送出請求。</pre>
      </div>
    </details>
  </main>

  <footer class="demo-footer-nav">
    <span>你現在在這裡：步驟 ② 自動轉換</span>
    <span>下一步：<a href="http://127.0.0.1:8004">前往審查協調 (步驟 ③)</a></span>
  </footer>

  <script>
    const output = document.getElementById('output');
    const jobId = document.getElementById('jobId');
    const jsonBody = document.getElementById('jsonBody');
    const convStatus = document.getElementById('convStatus');
    const failureBox = document.getElementById('failure');
    const jobStatusEl = document.getElementById('jobStatus');
    const progressBar = document.getElementById('progressBar');
    const startBtn = document.getElementById('startBtn');
    const resultGrid = document.getElementById('resultGrid');

    let latestPayload = null;
    let pollTimer = null;

    function readBody() { return JSON.parse(jsonBody.value); }

    function setServiceStatus(kind, label) {
      convStatus.className = `demo-status demo-status--${kind}`;
      convStatus.textContent = label;
      failureBox.classList.toggle('is-visible', kind === 'bad');
    }

    function setJobStatus(kind, label) {
      jobStatusEl.className = `demo-status demo-status--${kind}`;
      jobStatusEl.textContent = label;
    }

    function setStage(activeIndex, doneThrough) {
      for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`stage-${i}`);
        el.classList.remove('demo-stage--active', 'demo-stage--done');
        if (i <= doneThrough) el.classList.add('demo-stage--done');
        else if (i === activeIndex) el.classList.add('demo-stage--active');
      }
    }

    async function checkHealth() {
      try {
        const r = await fetch('/health');
        if (r.ok) setServiceStatus('ok', '已就緒');
        else setServiceStatus('bad', '未連線');
      } catch { setServiceStatus('bad', '未連線'); }
    }

    async function call(method, path, body) {
      output.textContent = `${method} ${path}\\n載入中…`;
      const init = { method, headers: { Accept: 'application/json' } };
      if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
      }
      try {
        const response = await fetch(path, init);
        const text = await response.text();
        try { latestPayload = JSON.parse(text); } catch { latestPayload = null; }
        if (latestPayload?.job_id) jobId.value = latestPayload.job_id;
        const result = latestPayload ? JSON.stringify(latestPayload, null, 2) : text;
        output.textContent = `${response.status} ${response.statusText}\\n${result}`;
        return latestPayload;
      } catch (error) {
        output.textContent = String(error);
        return null;
      }
    }

    async function startConversion() {
      startBtn.disabled = true;
      setJobStatus('warn', '建立轉換工作中…');
      setStage(1, 0);
      progressBar.style.width = '8%';
      resultGrid.style.display = 'none';

      const payload = await call('POST', '/api/conversions', readBody());
      if (!payload?.job_id) {
        setJobStatus('bad', '建立失敗');
        startBtn.disabled = false;
        return;
      }
      startPolling();
    }

    async function createJobRaw() {
      return call('POST', '/api/conversions', readBody());
    }
    async function mockConversion() {
      return call('POST', '/api/dev/mock-conversion-result', readBody());
    }
    async function getJob() {
      if (!jobId.value) return alert('請先輸入或建立 job_id');
      return call('GET', `/api/conversions/${jobId.value}`);
    }
    async function getResult() {
      if (!jobId.value) return alert('請先輸入或建立 job_id');
      return call('GET', `/api/conversions/${jobId.value}/result`);
    }

    function startPolling() {
      stopPolling();
      let tick = 0;
      pollTimer = setInterval(async () => {
        tick += 1;
        const payload = await getJob();
        const status = payload?.status ?? 'unknown';

        if (status === 'pending' || status === 'queued') {
          setJobStatus('warn', '等待中…');
          setStage(1, 0);
          progressBar.style.width = '15%';
        } else if (status === 'running' || status === 'in_progress') {
          const stage = Math.min(4, 1 + Math.floor(tick / 3));
          setJobStatus('warn', `轉換中…階段 ${stage}/4`);
          setStage(stage, stage - 1);
          progressBar.style.width = `${20 + stage * 18}%`;
        } else if (status === 'succeeded' || status === 'success') {
          setJobStatus('ok', '已完成');
          setStage(0, 4);
          progressBar.style.width = '100%';
          stopPolling();
          startBtn.disabled = false;
          showResult(payload);
        } else if (status === 'failed' || status === 'error') {
          setJobStatus('bad', '轉換失敗');
          stopPolling();
          startBtn.disabled = false;
        }
      }, 2000);
    }

    function stopPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }

    function showResult(payload) {
      const usdc = payload?.result?.usdc_url ?? payload?.usdc_url ?? '';
      const mapping = payload?.result?.mapping_url ?? payload?.mapping_url ?? '';
      document.getElementById('usdcLink').innerHTML = usdc
        ? `<a href="${escapeAttr(usdc)}" target="_blank" rel="noopener">${escapeHtml(usdc)}</a>` : '—';
      document.getElementById('mappingLink').innerHTML = mapping
        ? `<a href="${escapeAttr(mapping)}" target="_blank" rel="noopener">${escapeHtml(mapping)}</a>` : '—';
      resultGrid.style.display = 'grid';
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function escapeAttr(s) {
      if (/^\s*(javascript|data|vbscript):/i.test(s)) return '#';
      return escapeHtml(s);
    }

    checkHealth();
    setInterval(checkHealth, 8000);
  </script>
</body>
</html>
        """
    )
