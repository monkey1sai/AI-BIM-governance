const SAFE_TEXT = /^[^\0\r\n]{1,512}$/u;
const SAFE_SCRIPT = /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u;
const SAFE_RELATIVE = /^(?![A-Za-z]:)(?![\\/])(?!.*(?:^|[\\/])\.\.(?:[\\/]|$))[A-Za-z0-9._/\\-]+$/u;

function reject(message) { throw new Error(message); }

export const SAFE_VERIFICATION_EXECUTABLES = new Set(['docker', 'npm', 'npx', 'pwsh', 'python']);

export function assertSafeVerificationCommand(command) {
  if (command === null || typeof command !== 'object' || Array.isArray(command) ||
      !SAFE_VERIFICATION_EXECUTABLES.has(command.executable) || !Array.isArray(command.args) || command.args.length > 16 ||
      command.args.some((arg) => typeof arg !== 'string' || !SAFE_TEXT.test(arg))) reject('Gate command is outside the bounded executable/argument policy.');
  const args = command.args;
  switch (command.executable) {
    case 'python': {
      if (args.length < 4 || args[0] !== '-m' || args[1] !== 'pytest') reject('Python gates may only invoke pytest as a module.');
      const allowedFlags = new Set(['-q', '-p', 'no:cacheprovider']);
      for (const arg of args.slice(2)) {
        if (!allowedFlags.has(arg) && !SAFE_RELATIVE.test(arg)) reject('Pytest gate contains an unsafe argument.');
      }
      break;
    }
    case 'npm':
      if (args.length !== 2 || args[0] !== 'run' || !SAFE_SCRIPT.test(args[1])) reject('npm gates may only run one declared package script.');
      break;
    case 'npx':
      if (args.length !== 4 || args[0] !== '--no-install' || args[1] !== 'playwright' || args[2] !== 'test' ||
          !/^--config=[A-Za-z0-9._-]+\.ts$/u.test(args[3])) reject('npx gates may only run the already-installed Playwright binary with one local config.');
      break;
    case 'pwsh': {
      const fileIndex = args.indexOf('-File');
      if (fileIndex < 1 || fileIndex !== args.length - 2 || args[0] !== '-NoProfile' ||
          args.some((arg) => /^-(?:Command|EncodedCommand|CommandWithArgs|EncodedArguments)$/iu.test(arg)) ||
          !SAFE_RELATIVE.test(args[fileIndex + 1]) || !args[fileIndex + 1].replaceAll('\\', '/').startsWith('scripts/tests/')) {
        reject('PowerShell gates must use a fixed repository test file and cannot accept inline commands.');
      }
      const prefix = args.slice(1, fileIndex);
      const approvedPrefix = prefix.length === 1 && prefix[0] === '-NonInteractive' ||
        prefix.length === 3 && prefix[0] === '-ExecutionPolicy' && prefix[1] === 'Bypass' && prefix[2] === '-NonInteractive' ||
        prefix.length === 3 && prefix[0] === '-NonInteractive' && prefix[1] === '-ExecutionPolicy' && prefix[2] === 'Bypass';
      if (!approvedPrefix) reject('PowerShell gate prefix is not approved.');
      break;
    }
    case 'docker':
      if (args.length !== 9 || args[0] !== 'compose' || args[1] !== '-f' || args[3] !== '-f' ||
          args[5] !== '--env-file' || args[7] !== 'config' || args[8] !== '--quiet' ||
          ![args[2], args[4], args[6]].every((arg) => SAFE_RELATIVE.test(arg))) reject('Docker gate is outside the read-only compose-config policy.');
      break;
    default:
      reject('Gate executable is not approved.');
  }
}
