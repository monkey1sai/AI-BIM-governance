from fastapi.responses import HTMLResponse


def render_ui() -> HTMLResponse:
    return HTMLResponse(
        """
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Fake S3 Storage Demo UI</title>
  <style>
    body { margin: 0; font-family: system-ui, Segoe UI, sans-serif; background: #f7f9fc; color: #1f2933; }
    header { padding: 16px 24px; background: #243b53; color: #fff; }
    main { display: grid; grid-template-columns: minmax(320px, 420px) 1fr; gap: 16px; padding: 16px; }
    section { background: #fff; border: 1px solid #d9e2ec; border-radius: 8px; padding: 14px; }
    button, a.button { display: inline-flex; align-items: center; margin: 6px 6px 0 0; padding: 8px 10px; border: 1px solid #9fb3c8; border-radius: 6px; background: #fff; color: #102a43; cursor: pointer; text-decoration: none; font: inherit; }
    button.primary { background: #0f609b; color: #fff; border-color: #0f609b; }
    input { width: 100%; box-sizing: border-box; border: 1px solid #bcccdc; border-radius: 6px; padding: 8px; font: inherit; }
    label { display: block; margin: 10px 0 4px; font-size: 12px; font-weight: 700; text-transform: uppercase; color: #52606d; }
    pre { min-height: 420px; margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
    .links a { display: block; margin-top: 6px; color: #0f609b; }
  </style>
</head>
<body>
  <header>
    <h1>Fake S3 Storage Demo UI</h1>
    <p>Static file browser for local BIM review artifacts.</p>
  </header>
  <main>
    <section>
      <label for="basePath">demo artifact base path</label>
      <input id="basePath" value="/static/projects/project_demo_001/versions/version_demo_001" />
      <h2>Health and files</h2>
      <button onclick="call('GET', '/health')">GET /health</button>
      <button onclick="call('GET', '/api/dev/files')" class="primary">GET /api/dev/files</button>
      <button onclick="call('GET', '/api/dev/demo-files')">Check demo artifact files</button>
      <h2>Open demo files</h2>
      <div class="links">
        <a id="sourceLink" target="_blank">Open source.ifc</a>
        <a id="modelLink" target="_blank">Open model.usdc</a>
        <a id="ifcIndexLink" target="_blank">Open ifc_index.json</a>
        <a id="usdIndexLink" target="_blank">Open usd_index.json</a>
        <a id="mappingLink" target="_blank">Open element_mapping.json</a>
      </div>
      <h2>Shortcuts</h2>
      <a class="button" href="http://127.0.0.1:8001/ui" target="_blank">Open _bim-control UI</a>
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
    const basePath = document.getElementById('basePath');
    const fileLinks = {
      sourceLink: 'source.ifc',
      modelLink: 'model.usdc',
      ifcIndexLink: 'ifc_index.json',
      usdIndexLink: 'usd_index.json',
      mappingLink: 'element_mapping.json'
    };

    function refreshLinks() {
      for (const [id, name] of Object.entries(fileLinks)) {
        document.getElementById(id).href = `${basePath.value}/${name}`;
      }
    }
    basePath.addEventListener('input', refreshLinks);
    refreshLinks();

    async function call(method, path) {
      output.textContent = `${method} ${path}\\nLoading...`;
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
  </script>
</body>
</html>
        """
    )
