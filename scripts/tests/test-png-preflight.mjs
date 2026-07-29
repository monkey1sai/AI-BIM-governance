import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectPngBeforeDecode, MAX_PNG_FILE_BYTES } from '../../web-viewer-sample/scripts/lib/png-preflight.mjs';

function header(width, height) {
  const value = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(value);
  value.writeUInt32BE(13, 8);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

test('PNG IHDR is bound to the trusted viewport before decode', () => {
  assert.deepEqual(inspectPngBeforeDecode(header(1280, 720), { width: 1280, height: 720 }, 'actual'), { width: 1280, height: 720 });
  assert.throws(() => inspectPngBeforeDecode(header(4096, 4096), { width: 1280, height: 720 }, 'actual'), /pre-decode/u);
  assert.throws(() => inspectPngBeforeDecode(header(0xffffffff, 1), { width: 1280, height: 720 }, 'actual'), /pre-decode/u);
});

test('PNG byte and signature budgets fail before decoder allocation', () => {
  assert.throws(() => inspectPngBeforeDecode(Buffer.alloc(MAX_PNG_FILE_BYTES + 1), { width: 1, height: 1 }), /byte contract/u);
  const invalid = header(1, 1);
  invalid[0] = 0;
  assert.throws(() => inspectPngBeforeDecode(invalid, { width: 1, height: 1 }), /signature or IHDR/u);
});
