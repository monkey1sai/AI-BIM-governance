"""Demo UI for _s3_storage (step ① in the demo storyboard).

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
  <title>雲端倉庫 (Cloud Storage) — 步驟①</title>
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

    .demo-tree { font-family: var(--demo-font-mono); font-size: 13px; line-height: 1.85; background: var(--demo-bg-elevated); border: 1px solid var(--demo-border); border-radius: var(--demo-radius); padding: 16px; }
    .demo-tree__row { display: flex; align-items: center; gap: 8px; padding: 2px 0; }
    .demo-tree__name { color: var(--demo-text-primary); }
    .demo-tree__name--dir { color: var(--demo-text-secondary); }
    .demo-tree__meta { margin-left: auto; font-size: 12px; color: var(--demo-text-muted); }
    .demo-tree__row a { color: var(--demo-brand); text-decoration: none; }
    .demo-tree__row a:hover { color: var(--demo-brand-hover); text-decoration: underline; }

    .demo-btn { display: inline-flex; align-items: center; gap: 8px; padding: 10px 18px; background: var(--demo-brand); color: #fff; border: 1px solid var(--demo-brand); border-radius: var(--demo-radius); font: inherit; font-weight: 500; cursor: pointer; }
    .demo-btn:hover { background: var(--demo-brand-hover); }
    .demo-btn--secondary { background: transparent; color: var(--demo-text-primary); border-color: var(--demo-border-strong); }
    .demo-btn--secondary:hover { background: var(--demo-bg-elevated); }
    .demo-btn-caption { display: block; margin-top: 6px; font-size: 13px; color: var(--demo-text-secondary); }
    .demo-btn-caption::before { content: "↳ "; color: var(--demo-text-muted); }

    .demo-details { margin-top: 24px; padding: 12px 16px; background: var(--demo-bg-elevated); border: 1px solid var(--demo-border); border-radius: var(--demo-radius); }
    .demo-details > summary { cursor: pointer; font-size: 13px; color: var(--demo-text-secondary); list-style: none; user-select: none; }
    .demo-details > summary::before { content: "▸ "; }
    .demo-details[open] > summary::before { content: "▾ "; }
    .demo-details__body { margin-top: 16px; }
    .demo-details__body label { display: block; margin: 10px 0 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; color: var(--demo-text-secondary); }
    .demo-details__body input { width: 100%; background: var(--demo-bg); color: var(--demo-text-primary); border: 1px solid var(--demo-border); border-radius: var(--demo-radius); padding: 8px; font: inherit; }
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
    <div class="demo-header__brand">BIM 審查雲端 Demo｜雲端倉庫 (Cloud Storage)</div>
    <div class="demo-header__step-label">步驟 ① / 5</div>
  </header>

  <nav class="demo-stepbar" aria-label="Demo 流程">
    <a class="demo-stepbar__item demo-stepbar__item--active" href="#" aria-current="step">
      <span class="demo-stepbar__num">①</span>上傳建模 (Upload)
    </a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8003"><span class="demo-stepbar__num">②</span>自動轉換 (Convert)</a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8004"><span class="demo-stepbar__num">③</span>建立會議 (Meeting)</a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:5173"><span class="demo-stepbar__num">④</span>標記問題 (Mark)</a>
    <a class="demo-stepbar__item" href="http://127.0.0.1:8001"><span class="demo-stepbar__num">⑤</span>紀錄回寫 (Record)</a>
  </nav>

  <main class="demo-main">
    <section class="demo-card">
      <h1 class="demo-card__title">雲端倉庫狀態 <span id="storageStatus" class="demo-status demo-status--idle">檢查中</span></h1>
      <p class="demo-card__subtitle">
        這裡是「假的雲端物件儲存」(fake object storage)。
        所有原始建模檔 (.ifc / .rvt) 與轉換後的可審查模型 (.usdc) 都會被存放在這裡。
        在實際產品中，這個角色會由 AWS S3、Azure Blob 或企業的物件儲存承擔。
      </p>

      <div id="failure" class="demo-failure">
        <div class="demo-failure__title">雲端倉庫未連線 (Cloud storage offline)</div>
        <div class="demo-failure__hint">請在另一個終端機執行：cd _s3_storage &amp;&amp; uvicorn app.main:app --port 8002</div>
      </div>
    </section>

    <section class="demo-card">
      <h2 class="demo-card__title" style="font-size:16px;">示範專案的檔案 (Project files)</h2>
      <p class="demo-card__subtitle">
        以下是「示範專案 / 示範版本」目前在雲端倉庫裡的檔案。綠色號誌表示檔案存在；紅色表示尚未產出。
      </p>

      <div id="fileTree" class="demo-tree">讀取中…</div>

      <button class="demo-btn demo-btn--secondary" type="button" onclick="refreshAll()" style="margin-top:16px;">
        重新整理
        <span class="demo-btn-caption">向雲端倉庫重新查詢一次最新檔案狀態</span>
      </button>
    </section>

    <details class="demo-details">
      <summary>展開技術細節 (Show technical details)</summary>
      <div class="demo-details__body">
        <label for="basePath">Static base path</label>
        <input id="basePath" value="/static/projects/project_demo_001/versions/version_demo_001" />

        <h3 style="margin:16px 0 8px;font-size:13px;color:var(--demo-text-secondary);text-transform:uppercase;letter-spacing:0.06em;">Endpoints</h3>
        <button onclick="call('GET', '/health')">GET /health</button>
        <button onclick="call('GET', '/api/dev/files')">GET /api/dev/files</button>
        <button onclick="call('GET', '/api/dev/demo-files')">GET /api/dev/demo-files</button>

        <h3 style="margin:16px 0 8px;font-size:13px;color:var(--demo-text-secondary);text-transform:uppercase;letter-spacing:0.06em;">Raw response</h3>
        <pre id="output">尚未送出請求。</pre>
      </div>
    </details>
  </main>

  <footer class="demo-footer-nav">
    <span>你現在在這裡：步驟 ① 上傳建模</span>
    <span>下一步：<a href="http://127.0.0.1:8003">前往轉檔服務 (步驟 ②)</a></span>
  </footer>

  <script>
    const output = document.getElementById('output');
    const basePath = document.getElementById('basePath');
    const storageStatus = document.getElementById('storageStatus');
    const failureBox = document.getElementById('failure');
    const fileTree = document.getElementById('fileTree');

    const FILE_LABELS = {
      'source.ifc':            { label: '原始建模檔 (Source IFC)',          icon: '📄' },
      'model.usdc':            { label: '可審查 3D 模型 (Reviewable model)', icon: '🧊' },
      'element_mapping.json':  { label: '元件對照表 (Element mapping)',     icon: '🔗' },
      'ifc_index.json':        { label: 'IFC 索引 (IFC index)',             icon: '📑' },
      'usd_index.json':        { label: 'USD 索引 (USD index)',             icon: '📑' }
    };

    async function call(method, path) {
      output.textContent = `${method} ${path}\\n載入中…`;
      try {
        const response = await fetch(path, { method, headers: { Accept: 'application/json' } });
        const text = await response.text();
        let parsed = text;
        try { parsed = JSON.stringify(JSON.parse(text), null, 2); } catch {}
        output.textContent = `${response.status} ${response.statusText}\\n${parsed}`;
      } catch (error) {
        output.textContent = String(error);
      }
    }

    function setStatus(kind, label) {
      storageStatus.className = `demo-status demo-status--${kind}`;
      storageStatus.textContent = label;
      failureBox.classList.toggle('is-visible', kind === 'bad');
    }

    async function refreshAll() {
      setStatus('warn', '查詢中…');
      try {
        const r = await fetch('/health');
        if (!r.ok) throw new Error('health not ok');
      } catch {
        setStatus('bad', '未連線');
        fileTree.textContent = '雲端倉庫未連線';
        return;
      }
      setStatus('ok', '已連線');

      let demoFiles = null;
      try {
        demoFiles = await (await fetch('/api/dev/demo-files')).json();
      } catch {
        fileTree.textContent = '無法讀取檔案清單';
        return;
      }

      const items = demoFiles?.items ?? demoFiles?.files ?? [];
      const byName = new Map();
      for (const it of items) {
        const name = it.name ?? (it.path ? it.path.split('/').pop() : null);
        if (name) byName.set(name, it);
      }

      const rows = [];
      rows.push(`<div class="demo-tree__row"><span class="demo-tree__name demo-tree__name--dir">📁 projects/project_demo_001/versions/version_demo_001/</span></div>`);

      for (const [filename, info] of Object.entries(FILE_LABELS)) {
        const meta = byName.get(filename);
        const exists = meta?.exists ?? !!meta;
        const sizeText = meta?.size ? formatSize(meta.size) : '';
        const url = `${basePath.value}/${filename}`;
        const safeUrl = escapeAttr(url);
        const safeFilename = escapeHtml(filename);
        rows.push(
          `<div class="demo-tree__row">` +
          `&nbsp;&nbsp;${info.icon} ` +
          (exists
            ? `<a href="${safeUrl}" target="_blank" rel="noopener">${safeFilename}</a>`
            : `<span class="demo-tree__name">${safeFilename}</span>`) +
          `<span class="demo-status demo-status--${exists ? 'ok' : 'idle'}" style="margin-left:12px;">${exists ? '已存放' : '尚未產出'}</span>` +
          `<span class="demo-tree__meta">${escapeHtml(info.label)}${sizeText ? ' · ' + sizeText : ''}</span>` +
          `</div>`
        );
      }

      fileTree.innerHTML = rows.join('');
    }

    function formatSize(bytes) {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    }

    function escapeAttr(s) {
      const esc = escapeHtml(s);
      // strip dangerous schemes; only allow http(s)/relative URLs in href
      if (/^\s*(javascript|data|vbscript):/i.test(s)) return '#';
      return esc;
    }

    refreshAll();
    setInterval(refreshAll, 8000);
  </script>
</body>
</html>
        """
    )
