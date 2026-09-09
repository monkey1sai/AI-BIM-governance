import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { retryCarriesNewInformation } from '../../../scripts/lib/pr-convergence-state.mjs'

const FIELDS = ['head_sha', 'input_sha256', 'policy_sha256', 'verification_manifest_sha256', 'evidence_fingerprint']
function validate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== [...FIELDS].sort().join(',') ||
      FIELDS.some((field) => typeof value[field] !== 'string' ||
        !(field === 'head_sha' ? /^[0-9a-f]{40}$/ : /^[0-9a-f]{64}$/).test(value[field]))) {
    throw new Error('invalid_review_observation')
  }
}

// Pure admissibility check. It never grants authority, closes findings, or resets budgets.
export function reviewDispatch({ previous, next }) {
  validate(next)
  if (previous === null) return { decision: 'INITIAL_REVIEW', changed_fields: [], authorization_granted: false }
  validate(previous)
  const delta = retryCarriesNewInformation(previous, next)
  return { decision: delta.new_information ? 'REVIEW_DELTA' : 'NO_RETRY', changed_fields: delta.changed_fields, authorization_granted: false }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 2) throw new Error('usage: pipe {previous,next} JSON to review-dispatch.mjs')
    const chunks = []
    let size = 0
    for await (const chunk of process.stdin) {
      size += chunk.length
      if (size > 8192) throw new Error('review_observation_too_large')
      chunks.push(chunk)
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!input || Object.keys(input).sort().join(',') !== 'next,previous') throw new Error('invalid_review_input')
    process.stdout.write(JSON.stringify(reviewDispatch(input)) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ decision: 'INVALID', authorization_granted: false, detail: error.message }) + '\n')
    process.exitCode = 1
  }
}
