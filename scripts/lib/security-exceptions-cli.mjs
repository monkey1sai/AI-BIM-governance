#!/usr/bin/env node
import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { TextDecoder } from 'node:util';
import { validateSecurityExceptions } from './security-exceptions.mjs';

function readJson(filePath) {
  const item = lstatSync(filePath);
  if (!item.isFile() || item.isSymbolicLink() || item.size > 1024 * 1024) throw new Error('Input must be a bounded regular file.');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(filePath)));
}

try {
  if (process.argv.length !== 4) throw new Error('Usage: security-exceptions-cli.mjs <manifest> <registry>');
  const manifestPath = path.resolve(process.argv[2]);
  const registryPath = path.resolve(process.argv[3]);
  const manifest = readJson(manifestPath);
  const expectedRegistry = path.resolve(path.dirname(manifestPath), '..', manifest.security_policy.exception_registry);
  if (registryPath !== expectedRegistry) throw new Error('Registry path does not match the manifest policy.');
  const result = validateSecurityExceptions(readJson(registryPath), manifest, new Date());
  process.stdout.write(`[security-exceptions] result=${result.result} count=${result.exception_count}\n`);
} catch (error) {
  process.stderr.write(`[security-exceptions] ${error instanceof Error ? error.message : 'failed safely'}\n`);
  process.exitCode = 1;
}
