"""Demo UI for _bim-control (step ⑤ in the demo storyboard).

設計守則: docs/plans/BIM_REVIEW_DEMO_UI_GUIDELINES.md
跨服務 design tokens 權威來源: web-viewer-sample/src/styles/demo-theme.css
本檔的 :root CSS 變數需與該檔保持同步。
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
  <title>主資料庫 (BIM Data Authority) — 步驟⑤</title>
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
    body {
      background: var(--demo-bg);
      color: var(--demo-text-primary);
      font-family: var(--demo-font-sans);
      font-size: 14px;
      line-height: 1.55;
    }

    .demo-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 24px;
      background: var(--demo-bg-elevated);
      border-bottom: 1px solid var(--demo-border);
    }
    .demo-header__brand { font-size: 16px; font-weight: 600; }
    .demo-header__step-label { font-size: 13px; color: var(--demo-text-secondary); }

    .demo-stepbar {
      display: flex;
      gap: 4px;
      padding: 12px 24px;
      background: var(--demo-bg-elevated);
      border-bottom: 1px solid var(--demo-border);
      overflow-x: auto;
    }
    .demo-stepbar__item {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: var(--demo-radius);
      color: var(--demo-text-muted);
      text-decoration: none;
      font-size: 13px;
      white-space: nowrap;
    }
    .demo-stepbar__item:hover { background: var(--demo-brand-soft); color: var(--demo-text-secondary); }
    .demo-stepbar__item--active {
      background: var(--demo-brand-soft);
      color: var(--demo-text-primary);
      font-weight: 600;
    }
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
      background: var(--demo-brand);
      border-color: var(--demo-brand);
      color: #fff;
    }

    .demo-main { padding: 24px; max-width: 1200px; margin: 0 auto; }

    .demo-card {
      background: var(--demo-bg-card);
      border: 1px solid var(--demo-border);
      border-radius: var(--demo-radius-lg);
      padding: 24px;
      margin-bottom: 16px;
      box-shadow: 0 1px 2px rgba(16,42,67,0.08);
    }
    .demo-card__title { font-size: 20px; font-weight: 600; margin: 0 0 8px; }
    .demo-card__subtitle { font-size: 13px; color: var(--demo-text-secondary); margin: 0 0 16px; }

    .demo-status {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 500;
    }
    .demo-status::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
    .demo-status--ok   { color: var(--demo-status-ok);   background: var(--demo-status-ok-soft); }
    .demo-status--warn { color: var(--demo-status-warn); background: var(--demo-status-warn-soft); }
    .demo-status--bad  { color: var(--demo-status-bad);  background: var(--demo-status-bad-soft); }
    .demo-status--idle { color: var(--demo-status-idle); }

    .demo-summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 16px;
      margin-top: 16px;
    }
    .demo-summary-item {
      padding: 16px;
      background: var(--demo-bg-elevated);
      border: 1px solid var(--demo-border);
      border-radius: var(--demo-radius);
    }
    .demo-summary-item__label {
      font-size: 12px;
      color: var(--demo-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .demo-summary-item__value {
      margin-top: 6px;
      font-size: 22px;
      font-weight: 600;
    }
    .demo-summary-item__hint {
      margin-top: 4px;
      font-size: 12px;
      color: var(--demo-text-muted);
    }

    .demo-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 18px;
      background: var(--demo-brand);
      color: #fff;
      border: 1px solid var(--demo-brand);
      border-radius: var(--demo-radius);
      font: inherit;
      font-weight: 500;
      cursor: pointer;
    }
    .demo-btn:hover { background: var(--demo-brand-hover); }
    .demo-btn--secondary {
      background: transparent;
      color: var(--demo-text-primary);
      border-color: var(--demo-border-strong);
    }
    .demo-btn--secondary:hover { background: var(--demo-bg-elevated); }
    .demo-btn-caption { display: block; margin-top: 6px; font-size: 13px; color: var(--demo-text-secondary); }
    .demo-btn-caption::before { content: "↳ "; color: var(--demo-text-muted); }

    .demo-list {
      list-style: none;
      padding: 0;
      margin: 12px 0 0;
    }
    .demo-list li {
      padding: 10px 12px;
      background: var(--demo-bg-elevated);
      border: 1px solid var(--demo-border);
      border-radius: var(--demo-radius);
      margin-bottom: 6px;
      font-size: 13px;
      display: flex;
      justify-content: space-between;
      gap: 12px;
    }
    .demo-list .demo-list__meta { color: var(--demo-text-muted); font-size: 12px; }

    .demo-details {
      margin-top: 24px;
      padding: 12px 16px;
      background: var(--demo-bg-elevated);
      border: 1px solid var(--demo-border);
      border-radius: var(--demo-radius);
    }
    .demo-details > summary {
      cursor: pointer;
      font-size: 13px;
      color: var(--demo-text-secondary);
      list-style: none;
      user-select: none;
    }
    .demo-details > summary::before { content: "▸ "; }
    .demo-details[open] > summary::before { content: "▾ "; }
    .demo-details__body { margin-top: 16px; }
    .demo-details__body label {
      display: block;
      margin: 10px 0 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--demo-text-secondary);
    }
    .demo-details__body input,
    .demo-details__body textarea {
      width: 100%;
      background: var(--demo-bg);
      color: var(--demo-text-primary);
      border: 1px solid var(--demo-border);
      border-radius: var(--demo-radius);
      padding: 8px;
      font: inherit;
    }
    .demo-details__body textarea {
      min-height: 130px;
      font-family: var(--demo-font-mono);
      font-size: 12px;
    }
    .demo-details__grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .demo-details h3 {
      margin: 16px 0 8px;
      font-size: 13px;
      color: var(--demo-text-secondary);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .demo-details button {
      display: inline-flex;
      margin: 4px 4px 0 0;
      padding: 6px 10px;
      background: var(--demo-bg);
      color: var(--demo-text-primary);
      border: 1px solid var(--demo-border-strong);
      border-radius: var(--demo-radius);
      font: inherit;
      font-size: 12px;
      cursor: pointer;
    }
    .demo-details button:hover { background: var(--demo-brand-soft); }
    .demo-details pre {
      margin: 12px 0 0;
      padding: 12px;
      background: #0e1116;
      color: #d6e2f0;
      border-radius: var(--demo-radius);
      font-family: var(--demo-font-mono);
      font-size: 12px;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 300px;
      overflow-y: auto;
    }

    .demo-failure {
      border-left: 3px solid var(--demo-status-bad);
      background: var(--demo-status-bad-soft);
      padding: 12px 16px;
      border-radius: var(--demo-radius);
      margin: 16px 0;
      display: none;
    }
    .demo-failure.is-visible { display: block; }
    .demo-failure__title { font-weight: 600; color: var(--demo-status-bad); margin-bottom: 4px; }
    .demo-failure__hint { color: var(--demo-text-secondary); font-size: 13px; font-family: var(--demo-font-mono); }

    .demo-footer-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 24px;
      padding: 16px 24px;
      background: var(--demo-bg-elevated);
      border-top: 1px solid var(--demo-border);
      font-size: 13px;
      color: var(--demo-text-secondary);
    }
    .demo-footer-nav a { color: var(--demo-brand); text-decoration: none; font-weight: 500; }
    .demo-footer-nav a:hover { color: var(--demo-brand-hover); }
  </style>
</head>
<body>
  <header class="demo-header">
    <div class="demo-header__brand">BIM 審查雲端 Demo｜主資料庫 (BIM Data Authority)</div>
    <div class="demo-header__step-label">步驟 ⑤ / 5</div>
  </header>

  <nav class="demo-stepbar" aria-label="Demo 流程">
    <a class="demo-stepbar__item" href="http://127.0.0.1:8002" title="雲端倉庫">
      <span class="demo-stepbar__num">①</span>上傳建模 (Upload)
    </a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8003" title="轉檔服務">
      <span class="demo-stepbar__num">②</span>自動轉換 (Convert)
    </a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8004" title="審查協調">
      <span class="demo-stepbar__num">③</span>建立會議 (Meeting)
    </a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:5173" title="瀏覽器審查端">
      <span class="demo-stepbar__num">④</span>標記問題 (Mark)
    </a>
    <a class="demo-stepbar__item demo-stepbar__item--active" href="#" aria-current="step">
      <span class="demo-stepbar__num">⑤</span>紀錄回寫 (Record)
    </a>
  </nav>

  <main class="demo-main">
    <section class="demo-card">
      <h1 class="demo-card__title">主資料庫狀態 <span id="connStatus" class="demo-status demo-status--idle">檢查中</span></h1>
      <p class="demo-card__subtitle">
        這裡是「假的 BIM 主資料庫」。所有專案、模型版本、審查問題、審查標註都會被保存到這裡。
        在實際產品中，這個角色會由企業既有的 BIM 主平台 (BIM platform) 承擔。
      </p>

      <div id="failure" class="demo-failure">
        <div class="demo-failure__title">主資料庫未連線 (BIM data authority offline)</div>
        <div class="demo-failure__hint">請在另一個終端機執行：cd _bim-control &amp;&amp; uvicorn app.main:app --port 8001</div>
      </div>

      <div class="demo-summary-grid">
        <div class="demo-summary-item">
          <div class="demo-summary-item__label">目前示範專案</div>
          <div id="projectName" class="demo-summary-item__value">—</div>
          <div id="projectIdHint" class="demo-summary-item__hint">project id pending</div>
        </div>
        <div class="demo-summary-item">
          <div class="demo-summary-item__label">最新模型版本</div>
          <div id="versionName" class="demo-summary-item__value">—</div>
          <div id="versionIdHint" class="demo-summary-item__hint">version id pending</div>
        </div>
        <div class="demo-summary-item">
          <div class="demo-summary-item__label">已登錄成果檔</div>
          <div id="artifactCount" class="demo-summary-item__value">—</div>
          <div class="demo-summary-item__hint">含原始建模檔與可審查模型</div>
        </div>
        <div class="demo-summary-item">
          <div class="demo-summary-item__label">已記錄審查問題</div>
          <div id="issueCount" class="demo-summary-item__value">—</div>
          <div class="demo-summary-item__hint">由系統或 AI 規則檢查產生</div>
        </div>
      </div>
    </section>

    <section class="demo-card">
      <h2 class="demo-card__title" style="font-size:16px;">最近的審查紀錄 (Latest review notes)</h2>
      <p class="demo-card__subtitle">這是「步驟④ 標記問題」結束後寫回到主資料庫的標註紀錄。</p>
      <ul id="annotationsList" class="demo-list"><li>讀取中…</li></ul>
      <button class="demo-btn demo-btn--secondary" type="button" onclick="refreshAll()" style="margin-top:12px;">
        重新整理
        <span class="demo-btn-caption">向主資料庫重新查詢一次最新狀態</span>
      </button>
    </section>

    <details class="demo-details">
      <summary>展開技術細節 (Show technical details)</summary>
      <div class="demo-details__body">
        <div class="demo-details__grid">
          <div>
            <label for="projectId">project_id</label>
            <input id="projectId" value="project_demo_001" />
          </div>
          <div>
            <label for="modelVersionId">model_version_id</label>
            <input id="modelVersionId" value="version_demo_001" />
          </div>
        </div>
        <div class="demo-details__grid">
          <div>
            <label for="sessionId">session_id</label>
            <input id="sessionId" value="review_session_001" />
          </div>
          <div>
            <label for="issueId">issue_id</label>
            <input id="issueId" value="ISSUE-DEMO-001" />
          </div>
        </div>
        <label for="jsonBody">JSON request body</label>
        <textarea id="jsonBody">{
  "issue_id": "ISSUE-DEMO-001",
  "project_id": "project_demo_001",
  "source": "mock_compliance",
  "severity": "error",
  "status": "open",
  "title": "示範：樓梯寬度不足",
  "description": "用於手動驗證 issue highlight 與 annotation 流程的示範問題。",
  "ifc_guid": "2VJ3sK9L000fake001",
  "usd_prim_path": "/World"
}</textarea>

        <h3>Health &amp; seed</h3>
        <button onclick="call('GET', '/health')">GET /health</button>
        <button onclick="call('POST', '/api/dev/reset-seed')">POST /api/dev/reset-seed</button>

        <h3>Project &amp; model version</h3>
        <button onclick="call('GET', '/api/projects')">GET /api/projects</button>
        <button onclick="call('GET', `/api/projects/${projectId.value}`)">GET project</button>
        <button onclick="call('GET', `/api/projects/${projectId.value}/versions`)">GET versions</button>
        <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}`)">GET model version</button>

        <h3>Artifact &amp; conversion result</h3>
        <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/artifacts`)">GET artifacts</button>
        <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/conversion-result`)">GET conversion result</button>
        <button onclick="call('POST', `/api/model-versions/${modelVersionId.value}/conversion-result`, defaultConversionResult())">POST conversion result</button>

        <h3>Review issue &amp; annotation</h3>
        <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/review-issues`)">GET review issues</button>
        <button onclick="call('POST', `/api/model-versions/${modelVersionId.value}/review-issues`, readBody())">POST review issue</button>
        <button onclick="call('GET', `/api/review-sessions/${sessionId.value}/annotations`)">GET annotations</button>
        <button onclick="call('POST', `/api/review-sessions/${sessionId.value}/annotations`, defaultAnnotation())">POST annotation</button>

        <h3>Raw response</h3>
        <pre id="output">尚未送出請求。</pre>
      </div>
    </details>
  </main>

  <footer class="demo-footer-nav">
    <span>你現在在這裡：步驟 ⑤ 紀錄回寫</span>
    <span>下一步：<a href="http://127.0.0.1:5173">回到瀏覽器審查端 (步驟 ④)</a></span>
  </footer>

  <script>
    const output = document.getElementById('output');
    const projectId = document.getElementById('projectId');
    const modelVersionId = document.getElementById('modelVersionId');
    const sessionId = document.getElementById('sessionId');
    const jsonBody = document.getElementById('jsonBody');
    const connStatus = document.getElementById('connStatus');
    const failureBox = document.getElementById('failure');

    function readBody() { return JSON.parse(jsonBody.value); }

    function defaultConversionResult() {
      return {
        job_id: 'conv_manual_demo_001',
        status: 'succeeded',
        project_id: projectId.value,
        model_version_id: modelVersionId.value,
        source_url: `http://127.0.0.1:8002/static/projects/${projectId.value}/versions/${modelVersionId.value}/source.ifc`,
        usdc_url: `http://127.0.0.1:8002/static/projects/${projectId.value}/versions/${modelVersionId.value}/model.usdc`,
        mapping_url: `http://127.0.0.1:8002/static/projects/${projectId.value}/versions/${modelVersionId.value}/element_mapping.json`
      };
    }

    function defaultAnnotation() {
      return {
        annotation_id: `ann_demo_${Date.now()}`,
        project_id: projectId.value,
        model_version_id: modelVersionId.value,
        author_id: 'dev_user_001',
        title: '示範標註',
        body: '從假 BIM 資料平台 UI 手動建立的標註',
        usd_prim_path: '/World',
        ifc_guid: '2VJ3sK9L000fake001'
      };
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
        let parsed = text;
        try { parsed = JSON.stringify(JSON.parse(text), null, 2); } catch {}
        output.textContent = `${response.status} ${response.statusText}\\n${parsed}`;
        return { ok: response.ok, status: response.status, json: tryJson(text) };
      } catch (error) {
        output.textContent = String(error);
        return { ok: false, error };
      }
    }

    function tryJson(text) { try { return JSON.parse(text); } catch { return null; } }

    function setStatus(kind, label) {
      connStatus.className = `demo-status demo-status--${kind}`;
      connStatus.textContent = label;
      failureBox.classList.toggle('is-visible', kind === 'bad');
    }

    async function refreshAll() {
      setStatus('warn', '查詢中…');
      try {
        const health = await fetch('/health', { headers: { Accept: 'application/json' } });
        if (!health.ok) throw new Error('health not ok');
      } catch (e) {
        setStatus('bad', '未連線');
        document.getElementById('projectName').textContent = '—';
        document.getElementById('versionName').textContent = '—';
        document.getElementById('artifactCount').textContent = '—';
        document.getElementById('issueCount').textContent = '—';
        document.getElementById('annotationsList').innerHTML = '<li>主資料庫未連線</li>';
        return;
      }

      setStatus('ok', '已連線');

      try {
        const projects = await (await fetch(`/api/projects/${projectId.value}`)).json();
        document.getElementById('projectName').textContent = projects?.name ?? projects?.title ?? projectId.value;
        document.getElementById('projectIdHint').textContent = `project_id: ${projects?.project_id ?? projectId.value}`;
      } catch { document.getElementById('projectName').textContent = '—'; }

      try {
        const version = await (await fetch(`/api/model-versions/${modelVersionId.value}`)).json();
        document.getElementById('versionName').textContent = version?.name ?? version?.label ?? modelVersionId.value;
        document.getElementById('versionIdHint').textContent = `version_id: ${version?.model_version_id ?? modelVersionId.value}`;
      } catch { document.getElementById('versionName').textContent = '—'; }

      try {
        const artifactRes = await (await fetch(`/api/model-versions/${modelVersionId.value}/artifacts`)).json();
        const items = artifactRes?.items ?? artifactRes?.artifacts ?? [];
        document.getElementById('artifactCount').textContent = items.length;
      } catch { document.getElementById('artifactCount').textContent = '—'; }

      try {
        const issuesRes = await (await fetch(`/api/model-versions/${modelVersionId.value}/review-issues`)).json();
        const issues = issuesRes?.items ?? issuesRes?.issues ?? [];
        document.getElementById('issueCount').textContent = issues.length;
      } catch { document.getElementById('issueCount').textContent = '—'; }

      try {
        const annsRes = await (await fetch(`/api/review-sessions/${sessionId.value}/annotations`)).json();
        const anns = annsRes?.items ?? annsRes?.annotations ?? [];
        const ul = document.getElementById('annotationsList');
        if (anns.length === 0) {
          ul.innerHTML = '<li>目前還沒有審查標註寫回主資料庫。<span class="demo-list__meta">請完成步驟 ④。</span></li>';
        } else {
          ul.innerHTML = anns.slice(-8).reverse().map(a =>
            `<li><span>${escapeHtml(a.title ?? a.body ?? '(無標題)')}</span>` +
            `<span class="demo-list__meta">${escapeHtml(a.author_id ?? '—')}</span></li>`
          ).join('');
        }
      } catch {
        document.getElementById('annotationsList').innerHTML = '<li>讀取標註失敗</li>';
      }
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    refreshAll();
    setInterval(refreshAll, 8000);
  </script>
</body>
</html>
        """
    )
