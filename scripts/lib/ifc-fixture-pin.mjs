// scripts/lib/ifc-fixture-pin.mjs
// IFC fixture pinning against the shared MinIO authority (decisions D-16/D-17,
// plan §6.5): the fixture authority is bucket bim-control on the shared MinIO;
// every consumer pins bucket/key + etag + size (+ version_id when the bucket
// has versioning) and FAILS CLOSED on any mismatch — evidence is never taken
// against silently different data.
//
// The 89MB fixtures are almost certainly multipart uploads, so the S3 ETag is
// NOT a plain content MD5. Local caches therefore verify against a sidecar
// (<file>.pin.json) written at download time, never by re-hashing locally.
//
// Live HEAD calls reuse the coordinator's @aws-sdk/client-s3 dependency via
// createRequire — no second S3 client implementation, no hand-rolled SigV4.
// Pure logic (manifest validation, pin comparison, sidecar verdicts) has no
// SDK dependency so CI can test it without installing coordinator deps.

import { readFileSync } from 'node:fs';

export const MANIFEST_SCHEMA = 'ifc-fixture-manifest/v1';
export const SIDECAR_SCHEMA = 'ifc-fixture-cache-sidecar/v1';

export function loadManifest(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`ifc_fixture_pin: manifest not readable at ${path}: ${err.message}`);
  }
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (err) {
    throw new Error(`ifc_fixture_pin: manifest is not valid JSON: ${err.message}`);
  }
  return validateManifest(manifest);
}

export function validateManifest(manifest) {
  if (manifest?.schema_version !== MANIFEST_SCHEMA) {
    throw new Error(`ifc_fixture_pin: unsupported schema_version '${manifest?.schema_version}'.`);
  }
  if (!Array.isArray(manifest.entries)) {
    throw new Error('ifc_fixture_pin: manifest.entries must be an array.');
  }
  if (manifest.authority?.endpoint) {
    let endpoint;
    try {
      endpoint = new URL(String(manifest.authority.endpoint));
    } catch {
      throw new Error('ifc_fixture_pin: authority.endpoint must be an absolute URL.');
    }
    if (endpoint.protocol !== 'https:') {
      throw new Error('ifc_fixture_pin: authority.endpoint must use HTTPS.');
    }
  }
  const seen = new Set();
  for (const entry of manifest.entries) {
    const name = String(entry?.logical_name ?? '');
    if (!/^[^\\/]{1,128}$/.test(name)) {
      throw new Error(`ifc_fixture_pin: logical_name '${name}' must be a bare file name.`);
    }
    if (seen.has(name)) {
      throw new Error(`ifc_fixture_pin: duplicate logical_name '${name}'.`);
    }
    seen.add(name);
    if (!entry.bucket || typeof entry.bucket !== 'string') {
      throw new Error(`ifc_fixture_pin: entry '${name}' must name its bucket.`);
    }
    if (!entry.key || typeof entry.key !== 'string') {
      throw new Error(`ifc_fixture_pin: entry '${name}' must name its object key.`);
    }
    if (!entry.etag || typeof entry.etag !== 'string') {
      throw new Error(`ifc_fixture_pin: entry '${name}' must pin the object etag.`);
    }
    if (!Number.isInteger(entry.size_bytes) || entry.size_bytes <= 0) {
      throw new Error(`ifc_fixture_pin: entry '${name}' must pin a positive size_bytes.`);
    }
    if (entry.version_id !== null && typeof entry.version_id !== 'string') {
      throw new Error(`ifc_fixture_pin: entry '${name}' version_id must be a string or null.`);
    }
  }
  return manifest;
}

const normalizeEtag = (etag) => String(etag ?? '').replaceAll('"', '').trim();

// expected = manifest entry; observed = { etag, size_bytes, version_id } from a
// HEAD call or a cache sidecar. Fail closed: any discrepancy is a mismatch with
// named reasons, never a pass-with-warning.
export function comparePin(expected, observed) {
  const reasons = [];
  if (!observed || typeof observed !== 'object') {
    return { verdict: 'mismatch', reasons: ['observed_missing'] };
  }
  if (normalizeEtag(observed.etag) !== normalizeEtag(expected.etag)) {
    reasons.push(`etag_mismatch expected=${normalizeEtag(expected.etag)} observed=${normalizeEtag(observed.etag)}`);
  }
  if (Number(observed.size_bytes) !== Number(expected.size_bytes)) {
    reasons.push(`size_mismatch expected=${expected.size_bytes} observed=${observed.size_bytes}`);
  }
  if (expected.version_id !== null && expected.version_id !== undefined) {
    if (String(observed.version_id ?? '') !== String(expected.version_id)) {
      reasons.push(`version_mismatch expected=${expected.version_id} observed=${observed.version_id ?? ''}`);
    }
  }
  return reasons.length === 0 ? { verdict: 'match', reasons: [] } : { verdict: 'mismatch', reasons };
}

// Cache verdicts: a local file is only trustworthy through its sidecar, written
// at download time. No sidecar => unverifiable => the cache MUST NOT be used.
export function evaluateCacheSidecar(expected, sidecar, observedSha256) {
  if (!sidecar || typeof sidecar !== 'object') {
    return { verdict: 'unverifiable_no_sidecar', reasons: ['sidecar_missing'] };
  }
  if (sidecar.schema_version !== SIDECAR_SCHEMA) {
    return { verdict: 'unverifiable_no_sidecar', reasons: [`sidecar_schema '${sidecar.schema_version}'`] };
  }
  const pin = comparePin(expected, sidecar);
  if (pin.verdict !== 'match') {
    return { verdict: 'stale_cache', reasons: pin.reasons };
  }
  if (!/^[0-9a-f]{64}$/.test(String(sidecar.sha256 ?? ''))) {
    return { verdict: 'stale_cache', reasons: ['sidecar_sha256_invalid'] };
  }
  if (!/^[0-9a-f]{64}$/.test(String(observedSha256 ?? ''))) {
    return { verdict: 'stale_cache', reasons: ['observed_sha256_missing_or_invalid'] };
  }
  if (sidecar.sha256 !== observedSha256) {
    return { verdict: 'stale_cache', reasons: [`sha256_mismatch expected=${sidecar.sha256} observed=${observedSha256}`] };
  }
  return { verdict: 'cache_valid', reasons: [] };
}

export function buildSidecar(expected, downloadedSha256) {
  if (!/^[0-9a-f]{64}$/.test(String(downloadedSha256 ?? ''))) {
    throw new Error('ifc_fixture_pin: sidecar requires the sha256 of the downloaded bytes.');
  }
  return {
    schema_version: SIDECAR_SCHEMA,
    logical_name: expected.logical_name,
    bucket: expected.bucket,
    key: expected.key,
    etag: normalizeEtag(expected.etag),
    size_bytes: expected.size_bytes,
    version_id: expected.version_id ?? null,
    sha256: downloadedSha256,
  };
}

// --- live HEAD against MinIO (lazy SDK via the coordinator's dependency) -----

async function loadS3(coordinatorPackageJsonUrl) {
  const { createRequire } = await import('node:module');
  const require = createRequire(coordinatorPackageJsonUrl);
  return require('@aws-sdk/client-s3');
}

export async function headPin(entry, options) {
  const { endpoint, accessKeyId, secretAccessKey, coordinatorPackageJsonUrl } = options;
  if (!endpoint) throw new Error('ifc_fixture_pin: endpoint required for live HEAD.');
  if (!accessKeyId || !secretAccessKey) {
    throw new Error('ifc_fixture_pin: credentials required (bucket rejects anonymous access).');
  }
  const { S3Client, HeadObjectCommand } = await loadS3(
    coordinatorPackageJsonUrl ?? new URL('../../bim-review-coordinator/package.json', import.meta.url),
  );
  const client = new S3Client({
    endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  });
  try {
    const input = { Bucket: entry.bucket, Key: entry.key };
    if (entry.version_id !== null && entry.version_id !== undefined) {
      input.VersionId = entry.version_id;
    }
    const head = await client.send(new HeadObjectCommand(input));
    return {
      etag: normalizeEtag(head.ETag),
      size_bytes: Number(head.ContentLength),
      version_id: head.VersionId ?? null,
    };
  } finally {
    client.destroy();
  }
}
