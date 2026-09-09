import { createHash } from 'node:crypto'
import { open, realpath } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_BYTES = 262144
const fail = (detail) => { throw new Error(detail) }
const plain = (value) => value && typeof value === 'object' && !Array.isArray(value)
export const repoPath = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 &&
  !/[\\:*?<>|\x00-\x1f]/u.test(value) && !value.startsWith('/') &&
  value.split('/').every((part) => part && part !== '.' && part !== '..')

// No model, shell, imports from the plan, or interpretation of prose as metadata.
export function parsePlan(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('plan_too_large')
  const tasks = []
  let task = null
  let fence = null
  let metadataLines = null
  const finish = () => {
    if (!task) return
    if (!task.metadata) fail('task_metadata_missing')
    const m = task.metadata
    if (!plain(m) || Object.keys(m).sort().join(',') !== 'files,securitySensitive,symbols,userFacingTouch' ||
        !Array.isArray(m.files) || !m.files.length || m.files.length > 32 || !m.files.every(repoPath) ||
        new Set(m.files).size !== m.files.length || !Array.isArray(m.symbols) || m.symbols.length > 64 ||
        !m.symbols.every((s) => typeof s === 'string' && /^[\p{L}\p{N}_.$:#-]{1,200}$/u.test(s)) ||
        typeof m.userFacingTouch !== 'boolean' || typeof m.securitySensitive !== 'boolean') fail('task_metadata_invalid')
    const fullText = task.lines.join('\n')
    if (fullText.length > 16384) fail('task_too_large')
    tasks.push({ index: tasks.length, title: task.title, fullText, ...m, mechanical: false })
  }
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (fence) {
      task?.lines.push(line)
      const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/u)
      if (close && close[1][0] === fence.char && close[1].length >= fence.length) {
        if (metadataLines) {
          if (!task || task.metadata) fail('task_metadata_duplicate')
          try { task.metadata = JSON.parse(metadataLines.join('\n')) } catch { fail('task_metadata_invalid_json') }
        }
        fence = null
        metadataLines = null
      } else if (metadataLines) metadataLines.push(line)
      continue
    }
    const heading = line.match(/^### Task ([1-9][0-9]*): (\S.*)$/u)
    if (heading) {
      finish()
      if (Number(heading[1]) !== tasks.length + 1 || tasks.length >= 64 || heading[2].length > 200) fail('task_order_invalid')
      task = { title: heading[2], lines: [line], metadata: null }
      continue
    }
    if (/^### Task\b/u.test(line)) fail('task_heading_invalid')
    task?.lines.push(line)
    const start = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u)
    if (start) {
      fence = { char: start[1][0], length: start[1].length }
      if (start[2].trim() === 'spec-task') {
        if (!task) fail('task_metadata_without_task')
        metadataLines = []
      }
    }
  }
  if (fence) fail('unclosed_fence')
  finish()
  if (!tasks.length) fail('plan_has_no_tasks')
  return tasks
}

export async function readPlanPacket(root, planPath) {
  if (!repoPath(planPath) || !planPath.endsWith('.md')) fail('plan_path_invalid')
  const worktreeRoot = await realpath(root)
  const resolved = await realpath(path.resolve(worktreeRoot, planPath))
  const relative = path.relative(worktreeRoot, resolved)
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) fail('plan_path_escape')
  const file = await open(resolved, 'r')
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > MAX_BYTES) fail('plan_too_large_or_not_file')
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null)
      if (!bytesRead) break
      length += bytesRead
    }
    const after = await file.stat()
    if (length > MAX_BYTES || length !== before.size || before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs ||
        await realpath(path.resolve(worktreeRoot, planPath)) !== resolved) fail('plan_changed_during_read')
    const bytes = buffer.subarray(0, length)
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return {
      schema_version: 'spec-plan-packet/v1', attestation: 'coordinator-attested',
      worktreeRoot, planPath, planSha256: createHash('sha256').update(bytes).digest('hex'),
      tasks: parsePlan(text),
    }
  } finally { await file.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const argv = process.argv.slice(2)
    if (argv.length !== 4 || argv[0] !== '--root' || argv[2] !== '--plan') fail('usage: parse-plan.mjs --root <worktree> --plan <repo-relative.md>')
    process.stdout.write(JSON.stringify(await readPlanPacket(argv[1], argv[3])) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, held: 'plan_parse_failed', detail: error.message }) + '\n')
    process.exitCode = 1
  }
}
