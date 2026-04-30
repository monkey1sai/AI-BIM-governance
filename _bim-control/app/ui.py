from fastapi.responses import HTMLResponse


def render_ui() -> HTMLResponse:
    return HTMLResponse(
        """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fake BIM Control Demo UI</title>
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
    <h1>Fake BIM Control Demo UI</h1>
    <p>Manual triggers for project metadata, artifacts, issues, annotations, and demo seed data.</p>
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
      <label for="jsonBody">JSON body</label>
      <textarea id="jsonBody">{
  "issue_id": "ISSUE-DEMO-001",
  "project_id": "project_demo_001",
  "source": "mock_compliance",
  "severity": "error",
  "status": "open",
  "title": "Demo BIM issue highlight",
  "description": "Demo issue for manual highlight and annotation flow.",
  "ifc_guid": "2VJ3sK9L000fake001",
  "usd_prim_path": "/World"
}</textarea>

      <h2>Health and seed</h2>
      <button onclick="call('GET', '/health')">GET /health</button>
      <button onclick="call('POST', '/api/dev/reset-seed')" class="primary">POST /api/dev/reset-seed</button>

      <h2>Project APIs</h2>
      <button onclick="call('GET', '/api/projects')">GET /api/projects</button>
      <button onclick="call('GET', `/api/projects/${projectId.value}`)">GET project</button>
      <button onclick="call('GET', `/api/projects/${projectId.value}/versions`)">GET versions</button>
      <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}`)">GET model version</button>

      <h2>Artifact and conversion APIs</h2>
      <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/artifacts`)">GET artifacts</button>
      <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/conversion-result`)">GET conversion result</button>
      <button onclick="call('POST', `/api/model-versions/${modelVersionId.value}/conversion-result`, defaultConversionResult())">POST conversion result</button>

      <h2>Issue and annotation APIs</h2>
      <button onclick="call('GET', `/api/model-versions/${modelVersionId.value}/review-issues`)">GET review issues</button>
      <button onclick="call('POST', `/api/model-versions/${modelVersionId.value}/review-issues`, readBody())">POST review issue</button>
      <button onclick="call('GET', `/api/review-sessions/${sessionId.value}/annotations`)">GET annotations</button>
      <button onclick="call('POST', `/api/review-sessions/${sessionId.value}/annotations`, defaultAnnotation())">POST annotation</button>

      <h2>Shortcuts</h2>
      <a class="button" href="http://127.0.0.1:8002/ui" target="_blank">Open _s3_storage UI</a>
      <a class="button" href="http://127.0.0.1:8003/ui" target="_blank">Open conversion UI</a>
      <a class="button" href="http://127.0.0.1:8004/ui" target="_blank">Open coordinator UI</a>
    </section>
    <section>
      <h2>Response</h2>
      <pre id="output">No request yet.</pre>
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
        title: 'Demo annotation',
        body: 'Manual annotation from _bim-control UI',
        usd_prim_path: '/World',
        ifc_guid: '2VJ3sK9L000fake001'
      };
    }

    async function call(method, path, body) {
      output.textContent = `${method} ${path}\\nLoading...`;
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
