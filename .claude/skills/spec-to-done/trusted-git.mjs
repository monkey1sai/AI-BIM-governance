import crypto from 'node:crypto'
import fs from 'node:fs'
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

const windowsRuntimeAuthority = () => {
  if (process.platform !== 'win32') return null
  const runtimeRoot = path.parse(fs.realpathSync(process.execPath)).root
  const programFiles = path.join(runtimeRoot, 'Program Files')
  const windowsDirectory = path.join(runtimeRoot, 'Windows')
  const systemDirectory = path.join(windowsDirectory, 'System32')
  for (const directory of [programFiles, windowsDirectory, systemDirectory]) {
    const stat = fs.lstatSync(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink() ||
        normalizedPath(fs.realpathSync(directory)) !== normalizedPath(directory)) {
      throw new Error('trusted Windows runtime directory authority is unavailable')
    }
  }
  return { programFiles, windowsDirectory, systemDirectory }
}

export const isSystemGitPath = (resolvedGit) => {
  const normalized = normalizedPath(resolvedGit)
  if (process.platform === 'win32') {
    const authority = windowsRuntimeAuthority()
    return [
      path.join(authority.programFiles, 'Git', 'cmd', 'git.exe'),
      path.join(authority.programFiles, 'Git', 'bin', 'git.exe'),
      path.join(authority.programFiles, 'Git', 'mingw64', 'bin', 'git.exe'),
    ].some((candidate) => normalizedPath(candidate) === normalized)
  }
  return ['/usr/bin/git', '/usr/local/bin/git'].includes(normalized)
}

export const sanitizedGitEnvironment = (resolvedGit = '') => {
  // Never copy caller process state. Loader/runtime variables (LD_*, DYLD_*,
  // NODE_OPTIONS), proxy/TLS variables, and language-specific startup hooks can
  // execute or redirect code before an identity-bound child reaches main().
  const env = {}
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null'
  env.GIT_CONFIG_SYSTEM = process.platform === 'win32' ? 'NUL' : '/dev/null'
  env.GIT_CONFIG_NOSYSTEM = '1'
  env.GIT_TERMINAL_PROMPT = '0'
  env.GIT_OPTIONAL_LOCKS = '0'
  env.GIT_NO_REPLACE_OBJECTS = '1'
  env.GIT_LITERAL_PATHSPECS = '1'
  if (resolvedGit) {
    if (!isSystemGitPath(fs.realpathSync(resolvedGit))) {
      throw new Error('trusted child environment requires an approved system Git path')
    }
    const gitDir = path.dirname(resolvedGit)
    let safePath
    if (process.platform === 'win32') {
      const authority = windowsRuntimeAuthority()
      env.SystemRoot = authority.windowsDirectory
      env.WINDIR = authority.windowsDirectory
      safePath = [gitDir, authority.systemDirectory]
    } else {
      safePath = [gitDir, '/usr/bin', '/bin', '/usr/local/bin']
    }
    env.PATH = safePath.join(path.delimiter)
  }
  return env
}

export const gitInvocationArguments = (args) => [
  '--no-optional-locks',
  '--no-replace-objects',
  '-c', `core.hooksPath=${process.platform === 'win32' ? 'NUL' : '/dev/null'}`,
  '-c', `core.autocrlf=${process.platform === 'win32' ? 'true' : 'false'}`,
  '-c', 'core.longpaths=true',
  '-c', 'core.fsmonitor=false',
  '-c', 'core.pager=cat',
  '-c', 'diff.external=',
  '-c', 'core.attributesfile=',
  ...args,
]

export const parseTrustedRemoteMainResult = ({
  error = null,
  status = null,
  stdout = '',
  expectedRef = 'refs/heads/main',
} = {}) => {
  if (error || status !== 0) {
    throw new Error(`could not resolve live remote ${expectedRef} from the fixed trusted remote`)
  }
  const lines = String(stdout).split(/\r?\n/).filter((line) => line.length > 0)
  if (lines.length !== 1) {
    throw new Error('live trusted remote resolution returned malformed or multiple refs')
  }
  const match = /^([0-9a-f]{40})\t(.+)$/i.exec(lines[0])
  if (!match || match[2] !== expectedRef) {
    throw new Error('live trusted remote resolution did not return the exact remote main ref')
  }
  return match[1].toLowerCase()
}

export const assertTerminalP7Facts = ({
  mergeDescendsFromPrHead = false,
  liveRemoteMain = '',
  mergeCommit = '',
  prHeadAndMergeSameTree = false,
} = {}) => {
  if (!mergeDescendsFromPrHead) {
    throw new Error('P7 merge commit is not a proven descendant of the independently evidenced PR head')
  }
  if (String(liveRemoteMain).toLowerCase() !== String(mergeCommit).toLowerCase()) {
    throw new Error('P7 merge commit does not equal live remote refs/heads/main')
  }
  if (!prHeadAndMergeSameTree) {
    throw new Error('P7 merge commit tree differs from the independently evidenced PR head')
  }
}

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
