export const MAX_PNG_FILE_BYTES = 16 * 1024 * 1024;
export const MAX_PNG_DIMENSION = 4096;
export const MAX_PNG_PIXELS = 16 * 1024 * 1024;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function inspectPngBeforeDecode(buffer, expectedViewport, label = 'PNG') {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > MAX_PNG_FILE_BYTES) {
    throw new Error(`${label} exceeds the bounded PNG byte contract.`);
  }
  if (!buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
      buffer.readUInt32BE(8) !== 13 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error(`${label} has an invalid PNG signature or IHDR.`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const expectedWidth = expectedViewport?.width;
  const expectedHeight = expectedViewport?.height;
  if (!Number.isSafeInteger(expectedWidth) || !Number.isSafeInteger(expectedHeight) ||
      expectedWidth < 1 || expectedHeight < 1 || expectedWidth > MAX_PNG_DIMENSION || expectedHeight > MAX_PNG_DIMENSION ||
      expectedWidth * expectedHeight > MAX_PNG_PIXELS) {
    throw new Error(`${label} trusted viewport exceeds the PNG allocation budget.`);
  }
  if (width < 1 || height < 1 || width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION ||
      width * height > MAX_PNG_PIXELS || width !== expectedWidth || height !== expectedHeight) {
    throw new Error(`${label} dimensions fail the pre-decode viewport budget.`);
  }
  return { width, height };
}
