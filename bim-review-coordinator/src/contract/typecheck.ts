// Compile-time helpers used by the Coordinator Browser Contract to prove that a zod
// schema's output type is identical to the coordinator's own TypeScript type for
// the same wire shape. They produce no runtime code; `tsc --noEmit` is the judge.
//
// Usage inside a schema module:
//   type _ReviewSession = Expect<Equal<z.output<typeof reviewSession>, ReviewSession>>;
//
// If the interface in src/types.ts gains or loses a field and the schema is not
// updated, the assertion fails to compile. This is the only cheap way to keep the
// contract honest for responses that the coordinator already types; responses
// built as Record<string, unknown> get no such guard and rely on PR2's runtime
// validation instead.

export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;

export type Expect<T extends true> = T;
