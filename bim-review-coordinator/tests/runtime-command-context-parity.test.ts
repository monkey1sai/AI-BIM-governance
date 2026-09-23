// Command context parity (docs/architecture/mutation-gate-adr.md §3): the coordinator validates each authorized command's
// context with its own Zod schema. Read through the wire→runtime renames, each schema's key set must equal the fields Kit
// forwards, which are generated from x-kit-command.context in tests/contracts/kit-datachannel-v1.schema.json.
import { describe, expect, it } from "vitest";
import type { z } from "zod/v4";
import { KIT_COMMAND_CONTEXT_FIELDS } from "../src/generated/kit-command-vocabulary.js";
import { runtimeCommandContextSchemas, toRuntimeCommandContext } from "../src/services/runtimeMutationAuthority/runtimeMutationAuthority.js";

/** Top-level keys a schema accepts: an object's shape, or the union of its options' shapes. */
function schemaKeys(schema: z.ZodTypeAny): string[] {
  const node = schema as unknown as { shape?: Record<string, unknown>; options?: z.ZodTypeAny[] };
  if (node.shape) return Object.keys(node.shape);
  if (Array.isArray(node.options)) return [...new Set(node.options.flatMap(schemaKeys))];
  throw new Error("context schema is neither an object nor a union of objects");
}

describe("command context parity with the Kit Command Vocabulary", () => {
  it("validates the context of exactly the commands Kit forwards a context for", () => {
    expect(Object.keys(runtimeCommandContextSchemas).sort()).toEqual(Object.keys(KIT_COMMAND_CONTEXT_FIELDS).sort());
  });

  it.each(Object.entries(runtimeCommandContextSchemas))("%s accepts exactly the fields Kit forwards", (command, schema) => {
    const fields = KIT_COMMAND_CONTEXT_FIELDS[command as keyof typeof KIT_COMMAND_CONTEXT_FIELDS] ?? [];
    const runtime = toRuntimeCommandContext(command, Object.fromEntries(fields.map((field) => [field, null])));
    expect(Object.keys(runtime).sort()).toEqual(schemaKeys(schema).sort());
  });
});
