import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { canonicalContext, cfdContextDraft } from "../src/contract/schemas/cfdContext.js";

const fixture = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/fixtures/cfd-context-v1.json", import.meta.url), "utf8"));
const draft = () => structuredClone(fixture);

describe("manual CFD context identity", () => {
  it("matches the frozen cross-service canonical vector", () => {
    const result = canonicalContext(cfdContextDraft.parse(draft()));
    const vector = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/fixtures/cfd-context-canonical-v1.json", import.meta.url), "utf8"));
    expect(result.canonical_sha256).toBe(vector.canonical_sha256);
  });

  it("normalizes list order and signed zero without rounding geometry", () => {
    const a = draft();
    a.masses.push({ ...structuredClone(a.masses[0]), id: "neighbor_02" });
    const b = structuredClone(a);
    b.masses.reverse();
    b.masses[1].position_m[2] = -0;
    expect(canonicalContext(cfdContextDraft.parse(a))).toEqual(canonicalContext(cfdContextDraft.parse(b)));
    b.masses[0].position_m[0] += 0.00000001;
    expect(canonicalContext(cfdContextDraft.parse(b)).canonical_sha256).not.toBe(canonicalContext(cfdContextDraft.parse(a)).canonical_sha256);
  });

  it("preserves exact text and matches the vector across Unicode runtime versions", () => {
    const input = draft();
    const original = canonicalContext(cfdContextDraft.parse(input));
    input.masses[0].provenance.note = "測試尺寸 Cafe\u0301";
    expect(canonicalContext(cfdContextDraft.parse(input)).canonical_sha256).not.toBe(original.canonical_sha256);
    const vector = JSON.parse(fs.readFileSync(new URL("../../tests/contracts/fixtures/cfd-context-canonical-v1.json", import.meta.url), "utf8"));
    input.masses[0].provenance.note = vector.unicode_edge.note;
    const context = canonicalContext(cfdContextDraft.parse(input));
    expect(context.masses[0].provenance.note).toBe(vector.unicode_edge.note);
    expect(context.canonical_sha256).toBe(vector.unicode_edge.canonical_sha256);
  });

  it.each([
    ["duplicate ID", (d: any) => d.masses.push(structuredClone(d.masses[0]))],
    ["51 blocks", (d: any) => d.masses = Array.from({ length: 51 }, (_, i) => ({ ...d.masses[0], id: `block_${i}` }))],
    ["zero dimension", (d: any) => d.masses[0].dimensions_m[0] = 0],
    ["nonfinite dimension", (d: any) => d.masses[0].dimensions_m[0] = Infinity],
    ["boolean coordinate", (d: any) => d.masses[0].position_m[0] = true],
    ["invalid rotation", (d: any) => d.masses[0].rotation_degrees = 360],
    ["missing provenance", (d: any) => delete d.masses[0].provenance],
    ["blank provenance", (d: any) => d.masses[0].provenance.note = "   "],
    ["unpaired surrogate", (d: any) => d.masses[0].provenance.note = "\ud800"],
    ["foreign frame", (d: any) => d.frame.space = "gis"],
    ["unknown field", (d: any) => d.masses[0].opening = true],
    ["fractional revision", (d: any) => d.revision = 1.5],
    ["trailing newline ID", (d: any) => d.masses[0].id = "neighbor_01\n"],
    ["trailing newline hash", (d: any) => d.source.model_usdc_sha256 += "\n"],
  ])("rejects %s", (_name, mutate) => {
    const input = draft(); mutate(input);
    expect(cfdContextDraft.safeParse(input).success).toBe(false);
  });

  it("allows 50 unique masses, both supported up axes and a diagnostic empty context", () => {
    const input = draft();
    input.masses = Array.from({ length: 50 }, (_, i) => ({ ...input.masses[0], id: `block_${i}` }));
    input.frame.up_axis = "Y";
    expect(cfdContextDraft.safeParse(input).success).toBe(true);
    input.masses = [];
    expect(cfdContextDraft.safeParse(input).success).toBe(true);
  });

  it("counts Unicode scalar note length and requires exact numeric triples", () => {
    const input = draft();
    input.masses[0].provenance.note = "😀".repeat(500);
    expect(cfdContextDraft.safeParse(input).success).toBe(true);
    input.masses[0].provenance.note += "a";
    expect(cfdContextDraft.safeParse(input).success).toBe(false);
    for (const field of ["position_m", "dimensions_m"]) {
      for (const value of [[], [1, 2], [1, 2, 3, 4]]) {
        const bad = draft(); bad.masses[0][field] = value;
        expect(cfdContextDraft.safeParse(bad).success).toBe(false);
      }
    }
  });

  it.each(["revision", "geometry", "source", "provenance"])("includes %s in identity", (field) => {
    const a = draft(); const b = draft();
    if (field === "revision") b.revision++;
    if (field === "geometry") b.masses[0].rotation_degrees = 91;
    if (field === "source") b.source.model_usdc_sha256 = "b".repeat(64);
    if (field === "provenance") b.masses[0].provenance.kind = "measured";
    expect(canonicalContext(cfdContextDraft.parse(a)).canonical_sha256).not.toBe(canonicalContext(cfdContextDraft.parse(b)).canonical_sha256);
  });
});
