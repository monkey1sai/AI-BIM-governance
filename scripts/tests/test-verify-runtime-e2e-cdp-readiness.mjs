import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

const sourcePath = new URL('../verify-runtime-e2e-cdp.mjs', import.meta.url)

test('runtime CDP verifier wires canonical require-real observations before startup', async () => {
  const source = await fs.readFile(sourcePath, 'utf8')

  assert.match(source, /process\.env\.E2E_REQUIRE_REAL === ["']1["']/u)
  assert.match(source, /process\.env\.E2E_STACK_MANIFEST/u)
  assert.match(source, /process\.env\.E2E_SKIP === ["']1["']/u)
  assert.match(source, /process\.env\.RUNTIME_E2E_MODE/u)
  assert.match(source, /inspectRealE2E\(realE2EOptions\)/u)
  assert.match(source, /inspectReadiness\(last, page\.console, readinessOptions\(options\)\)/u)
  assert.match(source, /skipped: e2eSkipObservation/u)
  assert.match(source, /mode: e2eModeObservation/u)

  const preflightIndex = source.indexOf('const startupRealE2E = inspectRealE2E(realE2EOptions)')
  const outputDirectoryIndex = source.indexOf('await fs.mkdir(evidenceDir')
  const launchCallIndex = source.indexOf('chrome = await launchChrome')
  assert.ok(preflightIndex >= 0, 'canonical preflight must be executable')
  assert.ok(outputDirectoryIndex > preflightIndex, 'preflight precedes evidence writes')
  assert.ok(launchCallIndex > preflightIndex, 'preflight precedes Chrome startup')
})
