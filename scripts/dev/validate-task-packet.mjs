#!/usr/bin/env node
import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { taskPacketVersions, validateTaskPacket, validateTaskPacketCorpus } from '../lib/task-packet.mjs';

function parseArguments(argv) {
  if (argv.length !== 2 || argv[0] !== '--input' || !argv[1]) throw new Error('usage: validate-task-packet.mjs --input <json>');
  return resolve(argv[1]);
}

function loadBoundedJson(path) {
  const limit = 1024 * 1024;
  const pathStats = lstatSync(path);
  if (pathStats.isSymbolicLink()) throw new Error('input must not be a symbolic link');
  const descriptor = openSync(path, 'r');
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.size > limit) throw new Error('input must be a regular JSON file no larger than 1 MiB');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const bytesRead = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    const after = fstatSync(descriptor);
    if (length > limit || length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error('input changed while being read or exceeds 1 MiB');
    }
    return JSON.parse(buffer.subarray(0, length).toString('utf8'));
  } finally {
    closeSync(descriptor);
  }
}

export function main(argv = process.argv.slice(2)) {
  try {
    const input = loadBoundedJson(parseArguments(argv));
    const kind = input.schema_version === taskPacketVersions.corpus ? 'corpus' : 'packet';
    if (kind === 'corpus') validateTaskPacketCorpus(input);
    else validateTaskPacket(input);
    const result = {
      schema_version: 'task-packet-validation-result/v1',
      valid: true,
      kind,
      packet_count: kind === 'corpus' ? input.tasks.length : 1,
      packet_ids: kind === 'corpus' ? input.tasks.map((packet) => packet.id) : [input.id],
      authorization_granted: false,
      authorization_scope: 'validation_only',
      external_lane_s_authorization_required: kind === 'corpus'
        ? input.tasks.some((packet) => packet.lane === 'S')
        : input.lane === 'S',
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schema_version: 'task-packet-validation-result/v1', valid: false,
      error: { code: 'task_packet_invalid', message: String(error?.message || error) },
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) main();
