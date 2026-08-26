import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const normalizedPath = (value) => {
  const normalized = path.resolve(String(value || '')).replace(/\\/g, '/').replace(/\/$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

const isWithinPath = (value, root) => {
  const target = normalizedPath(value)
  const base = normalizedPath(root)
  return target === base || target.startsWith(`${base}/`)
}

const isSystemGitPath = (resolvedGit) => {
  const normalized = normalizedPath(resolvedGit)
  if (process.platform === 'win32') {
    return /^[a-z]:\/program files\/git\/(?:cmd|bin|mingw64\/bin)\/git\.exe$/.test(normalized)
  }
  return ['/usr/bin/git', '/usr/local/bin/git'].includes(normalized)
}

const isPytestFixtureGit = (resolvedGit, resolvedWorktree) => {
  if (!process.env.PYTEST_CURRENT_TEST) return false
  let temporaryRoot
  try {
    temporaryRoot = fs.realpathSync(os.tmpdir())
  } catch {
    return false
  }
  return isWithinPath(resolvedGit, temporaryRoot) &&
    isWithinPath(resolvedWorktree, temporaryRoot) &&
    !isWithinPath(resolvedGit, resolvedWorktree)
}

const assertSystemGitNotCallerWritable = (resolvedGit) => {
  const stat = fs.statSync(resolvedGit)
  if (!stat.isFile()) throw new Error('trusted Git path is not a regular file')
  if (typeof process.getuid === 'function') {
    const uid = process.getuid()
    if (uid === stat.uid || (stat.mode & 0o022) !== 0) {
      throw new Error('trusted Git must be owned by another account and not group/other writable')
    }
  }
  let handle
  try {
    handle = fs.openSync(resolvedGit, fs.constants.O_RDWR)
    throw new Error('trusted Git is writable by the current process identity')
  } catch (error) {
    if (handle != null) {
      fs.closeSync(handle)
      throw error
    }
    if (!['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) throw error
  }
}

export const sanitizedGitEnvironment = () => {
  const env = { ...process.env }
  const unsafeExactKeys = new Set(['CURL_CA_BUNDLE', 'SSL_CERT_FILE', 'SSL_CERT_DIR'])
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase()
    if (upper.startsWith('GIT_') || unsafeExactKeys.has(upper)) delete env[key]
  }
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
  env.GIT_CONFIG_SYSTEM = process.platform === 'win32' ? 'NUL' : '/dev/null'
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_NO_REPLACE_OBJECTS = '1'
  env.GIT_LITERAL_PATHSPECS = '1'
  return env
}

export const gitInvocationArguments = (args) => [
  '--no-optional-locks',
  '--no-replace-objects',
  '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
  '-c', `core.autocrlf=${process.platform === 'win32' ? 'true' : 'false'}`,
  '-c', 'core.fsmonitor=false',
  '-c', 'core.pager=cat',
  '-c', 'diff.external=',
  '-c', 'core.attributesfile=',
  ...args,
]

export const resolveTrustedGit = (gitExe, expectedWorktree) => {
  if (!path.isAbsolute(gitExe || '') || !fs.existsSync(gitExe)) {
    throw new Error('--git-exe must name an existing absolute Git executable')
  }
  if (!path.isAbsolute(expectedWorktree || '') || !fs.existsSync(expectedWorktree) ||
      !fs.statSync(expectedWorktree).isDirectory() ||
      fs.lstatSync(expectedWorktree).isSymbolicLink()) {
    throw new Error('expected worktree must be an existing, non-symlink absolute directory')
  }
  if (fs.lstatSync(gitExe).isSymbolicLink()) {
    throw new Error('--git-exe must not be a symlink or reparse point')
  }

  const resolvedGit = fs.realpathSync(gitExe)
  const resolvedWorktree = fs.realpathSync(expectedWorktree)
  if (!['git', 'git.exe'].includes(path.basename(resolvedGit).toLowerCase()) ||
      isWithinPath(resolvedGit, resolvedWorktree)) {
    throw new Error('--git-exe must resolve to Git outside the governed worktree')
  }

  let trustClass
  if (isSystemGitPath(resolvedGit)) {
    assertSystemGitNotCallerWritable(resolvedGit)
    trustClass = 'system-owned-read-only'
  } else if (isPytestFixtureGit(resolvedGit, resolvedWorktree)) {
    trustClass = 'pytest-temporary-fixture'
  } else {
    throw new Error('--git-exe is not an approved system Git path')
  }

  const buffer = fs.readFileSync(resolvedGit)
  return {
    resolvedGit,
    resolvedWorktree,
    trustClass,
    executableSha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    executableBytes: buffer.length,
  }
}
