from fastapi.responses import HTMLResponse


def render_ui() -> HTMLResponse:
    return HTMLResponse(
        """
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>假 BIM 資料平台 Demo UI</title>
  <style>
    body { margin: 0; font-family: system-ui, Segoe UI, sans-serif; background: #f6f8fb; color: #1f2933; }
    header { padding: 16px 24px; background: #1f2933; color: #fff; }
    main { display: grid; grid-template-columns: minmax(320px, 460px) 1fr; gap: 16px; padding: 16px; }
    section { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; }
    label { display: block; margin: 10px 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #52606d; }
    input, textarea { width: 100%; box-sizing: border-box; border: 1px solid #bcccdc; border-radius: 6px; padding: 8px; font: inherit; }
    textarea { min-height: 130px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    button, a.button { display: inline-flex; align-items: center; margin: 6px 6px 0 0; padding: 8px 10px; border: 1px solid #9fb3c8; border-radius: 6px; background: #fff; color: #102a43; cursor: pointer; text-decoration: none; font: inherit; }
    button.primary { background: #0f609b; color: #fff; border-color: #0f609b; }
    pre { min-height: 420px; margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  </style>
</head>
<body>
  <header>
    <h1>假 BIM 資料平台 Demo UI</h1>
    <p>用瀏覽器手動觸發專案資料、模型版本、成果檔、審查問題、標註與示範種子資料。</p>
  </header>
  <main>
    <section>
      <div class="grid">
        <div>
          <label for="projectId">project_id</label>
          <input id="projectId" value="project_demo_001" />
        </div>
        <div>
          <label for="modelVersionId">model_version_id</label>
          <input id="modelVersionId" value="version_demo_001" />
        </div>
      </div>
      <div class="grid">
        <div>
          <label for="sessionId">session_id</label>
          <input id="sessionId" value="review_session_001" />
        </div>
        <div>
          <label for="issueId">issue_id</label>
          <input id="issueId" value="ISSUE-DEMO-001" />
        </div>
      </div>
      <label for="jsonBody">JSON 請求內容</label>
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

      <h2>健康檢查與種子資料</h2>
      <button onclick="call('GET', '/health')">健康檢查 GET /health</button>
      <button onclick="call('POST', '/api/dev/reset-seed')" class="primary">重設示範資料 POST /api/dev/reset-seed</button>

      <h2>專案與模型版本 API</h2>
      <button onclick="call('GET', '/api/projects')">讀取專案清單 GET /api/projects</button>
      <button onclick="call('GET', `/api/projects/${projectId.value}`)">讀取單一專案 GET project</button>
      <button onclick="call('GET', `/api/projects/${projectId.value}/versions`)">讀取模型版本 GET versions</button>
      <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}`)">讀取模型版本詳情 GET model version</button>

      <h2>成果檔與轉檔結果 API</h2>
      <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/artifacts`)">讀取成果檔 GET artifacts</button>
      <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/conversion-result`)">讀取轉檔結果 GET conversion result</button>
      <button onclick="call('POST', `/api/model-versions/${modelVersionId.value}/conversion-result`, defaultConversionResult())">寫入轉檔結果 POST conversion result</button>

      <h2>審查問題與標註 API</h2>
      <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/review-issues`)">讀取審查問題 GET review issues</button>
      <button onclick="call('POST', `/api/model-versions/${modelVersionId.value}/review-issues`, readBody())">建立審查問題 POST review issue</button>
      <button onclick="call('GET', `/api/review-sessions/${sessionId.value}/annotations`)">讀取標註 GET annotations</button>
      <button onclick="call('POST', `/api/review-sessions/${sessionId.value}/annotations`, defaultAnnotation())">建立標註 POST annotation</button>

      <h2>快速開啟其他控制台</h2>
      <a class="button" href="http://127.0.0.1:8002/ui" target="_blank">開啟假物件儲存 UI</a>
      <a class="button" href="http://127.0.0.1:8003/ui" target="_blank">開啟轉檔服務 UI</a>
      <a class="button" href="http://127.0.0.1:8004/ui" target="_blank">開啟協作控制台 UI</a>
    </section>
    <section>
      <h2>回應結果</h2>
      <pre id="output">尚未送出請求。</pre>
    </section>
  </main>
  <script>
    const output = document.getElementById('output');
    const projectId = document.getElementById('projectId');
    const modelVersionId = document.getElementById('modelVersionId');
    const sessionId = document.getElementById('sessionId');
    const jsonBody = document.getElementById('jsonBody');

    function readBody() {
      return JSON.parse(jsonBody.value);
    }

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
      output.textContent = `${method} ${path}\\n載入中...`;
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
      } catch (error) {
        output.textContent = String(error);
      }
    }
  </script>
</body>
</html>
        """
    )
