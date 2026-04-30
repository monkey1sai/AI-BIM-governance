from fastapi.responses import HTMLResponse


def render_ui() -> HTMLResponse:
    return HTMLResponse(
        """
<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>轉檔服務 Demo UI</title>
  <style>
    body { margin: 0; font-family: system-ui, Segoe UI, sans-serif; background: #f6f8fb; color: #1f2933; }
    header { padding: 16px 24px; background: #102a43; color: #fff; }
    main { display: grid; grid-template-columns: minmax(360px, 520px) 1fr; gap: 16px; padding: 16px; }
    section { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; }
    label { display: block; margin: 10px 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #52606d; }
    input, textarea { width: 100%; box-sizing: border-box; border: 1px solid #bcccdc; border-radius: 6px; padding: 8px; font: inherit; }
    textarea { min-height: 190px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; font-size: 12px; }
    button, a.button { display: inline-flex; align-items: center; margin: 6px 6px 0 0; padding: 8px 10px; border: 1px solid #9fb3c8; border-radius: 6px; background: #fff; color: #102a43; cursor: pointer; text-decoration: none; font: inherit; }
    button.primary { background: #0f609b; color: #fff; border-color: #0f609b; }
    pre { min-height: 460px; margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  </style>
</head>
<body>
  <header>
    <h1>轉檔服務 Demo UI</h1>
    <p>手動建立 IFC/RVT/DWG 轉 USDC job、輪詢狀態、查詢結果，並提供 dev-only mock fallback。</p>
  </header>
  <main>
    <section>
      <div class="grid">
        <div>
          <label for="jobId">job_id</label>
          <input id="jobId" placeholder="conv_..." />
        </div>
        <div>
          <label for="pollState">輪詢狀態</label>
          <input id="pollState" value="已停止" readonly />
        </div>
      </div>
      <label for="jsonBody">建立轉檔 job 的 JSON 請求內容 POST /api/conversions</label>
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

      <h2>健康檢查</h2>
      <button onclick="call('GET', '/health')">健康檢查 GET /health</button>

      <h2>轉檔 job</h2>
      <button class="primary" onclick="createJob()">建立轉檔 job POST /api/conversions</button>
      <button onclick="getJob()">查詢 job 狀態 GET job status</button>
      <button onclick="getResult()">查詢 job 結果 GET job result</button>
      <button onclick="startPolling()">每 2 秒自動輪詢</button>
      <button onclick="stopPolling()">停止輪詢</button>

      <h2>Dev fallback</h2>
      <button onclick="mockConversion()" class="primary">建立 mock 轉檔結果 POST /api/dev/mock-conversion-result</button>

      <h2>結果捷徑</h2>
      <button onclick="copyFromResult('usdc_url')">複製 usdc_url</button>
      <button onclick="copyFromResult('mapping_url')">複製 mapping_url</button>
      <button onclick="openFromResult('usdc_url')">開啟 usdc_url</button>
      <button onclick="openFromResult('mapping_url')">開啟 mapping_url</button>
      <a class="button" href="http://127.0.0.1:8001/ui" target="_blank">開啟假 BIM 資料平台 UI</a>
      <a class="button" href="http://127.0.0.1:8004/ui" target="_blank">開啟協作控制台 UI</a>
    </section>
    <section>
      <h2>回應結果</h2>
      <pre id="output">尚未送出請求。</pre>
    </section>
  </main>
  <script>
    const output = document.getElementById('output');
    const jobId = document.getElementById('jobId');
    const pollState = document.getElementById('pollState');
    const jsonBody = document.getElementById('jsonBody');
    let latestPayload = null;
    let pollTimer = null;

    function readBody() {
      return JSON.parse(jsonBody.value);
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

    async function createJob() {
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
      pollState.value = '輪詢中';
      pollTimer = setInterval(async () => {
        const payload = await getJob();
        if (payload && ['succeeded', 'failed'].includes(payload.status)) stopPolling();
      }, 2000);
    }

    function stopPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      pollState.value = '已停止';
    }

    function valueFromResult(key) {
      return latestPayload?.result?.[key] || latestPayload?.[key] || '';
    }

    async function copyFromResult(key) {
      const value = valueFromResult(key);
      if (!value) return alert(`${key} 目前沒有可用值`);
      await navigator.clipboard.writeText(value);
    }

    function openFromResult(key) {
      const value = valueFromResult(key);
      if (!value) return alert(`${key} 目前沒有可用值`);
      window.open(value, '_blank');
    }
  </script>
</body>
</html>
        """
    )
