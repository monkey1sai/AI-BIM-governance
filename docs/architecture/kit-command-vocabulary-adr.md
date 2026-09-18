# ADR: Kit Command Vocabulary single source

## Status

Accepted on 2026-09-18. Supersedes §10 "Mutator catalog ownership" of
[runtime-mutation-authority-adr.md](runtime-mutation-authority-adr.md) for where
the command vocabulary is declared. Runtime Mutation Authority policy is unchanged.

## Context

The viewer, the coordinator and Kit each hand-maintained the DataChannel command
vocabulary: which commands exist, which mutate the stage, which are stage-load or
harness-only, which results answer which command, the rejection reasons, and payload
values such as camera presets and the fly-speed range. A tests-only fixture
(`tests/contracts/runtime-mutation-authority-v1.json`) guarded the coordinator and Kit
lists but not the viewer, and it recorded neither result pairing nor which commands
Kit may refuse. Adding camera view, camera state and fly speed touched about 24
production files across three runtimes, and the copies had drifted: the schema's
`commandRejected.rejected_event_type` omitted five commands that Kit does refuse, and
the contract document listed eight of thirteen mutators.

## Decision

1. `tests/contracts/kit-datachannel-v1.schema.json` is the single declaration. Every
   viewer→Kit request in `$defs` carries
   `x-kit-command: { mutates, stageLoad?, harnessOnly?, results[] }`, including
   read-only commands. Kit→viewer events are the remaining `oneOf` entries. Every
   command may be refused, so `commandRejected.rejected_event_type` lists them all.
   Payload values that other code must share carry `x-kit-constant` on a string enum
   or on a number with `minimum` and `maximum`; the annotation is opt-in.
2. `web-viewer-sample/scripts/generate-kit-command-vocabulary.mjs`, using Node built-ins
   only, writes committed data-only files for the viewer, the coordinator and the Kit
   messaging extension. Each starts with `source-sha256` of the LF-normalised schema.
   It refuses a schema whose rejection enum does not list every command.
3. Each runtime's existing owner imports the generated data internally and keeps its
   public names: the viewer's `runtimeCommandProtocol.ts` and `runtimeEventCatalog.ts`,
   the coordinator's Runtime Mutation Authority, and Kit's `runtime_authority.py`.
   Generated files are implementation detail behind those owners. The mutator catalog
   stays internal Runtime Mutation Authority policy; only its values come from here.
4. Drift is caught by each runtime's own tests. Viewer Vitest compares all three
   outputs with a fresh render; coordinator Vitest and Kit pytest compare the
   `source-sha256` header with the schema.
5. `tests/contracts/runtime-mutation-authority-v1.json` is retired.

Payload validators and payload types stay hand-written in each runtime, referencing
generated constants where a value is shared.

## Alternatives rejected

- Keep the tests-only fixture and add a viewer test: drift is found after the fact,
  every command still needs one hand edit per runtime list, and pairing and
  refusability stay unrecorded.
- Declare the vocabulary in coordinator TypeScript/Zod, like the Coordinator Browser
  Contract: the coordinator owns only the authorization policy for this contract, and
  Kit would need a TypeScript → JSON → Python chain.
- Generate payload types or cross-language validators: `oneOf`, `not` and
  `unevaluatedProperties` translate inconsistently between generators, and it would
  move Runtime Mutation Authority policy out of its module.
- Load one shared file at runtime from all three runtimes: this is the deployment
  coupling the Runtime Mutation Authority ADR rejected. Committed per-runtime output
  avoids it.

## Consequences

- A new command is declared once in the schema and then regenerated with
  `cd web-viewer-sample && npm run generate:kit-command-vocabulary`. Handlers, UI and
  validators are still written by hand.
- Editing a generated file by hand fails the viewer generator test. Changing the schema
  without regenerating fails every runtime's drift test.
- `pr-safety` does not run service tests, so drift is caught by each service's targeted
  tests, as with the Coordinator Browser Contract.
