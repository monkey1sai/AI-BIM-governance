import { describe, expect, it } from "vitest";
import { filterIssues, isCfdIssue } from "./issueFilter";

const rows = [
  { id: "a", kind: "issue" as const, usd_prim_path: "/World/Model/Door_01" },
  { id: "b", kind: "annotation" as const, usd_prim_path: null },
  { id: "c", kind: "annotation" as const, usd_prim_path: "/World/Overlays/Cfd/cfd_20260922T082409Z_abcdef/PedestrianWind_1p5m" },
  // Same prefix without the separator must not count as a CFD overlay prim.
  { id: "d", kind: "annotation" as const, usd_prim_path: "/World/Overlays/CfdOther/x" },
];

describe("issueFilter", () => {
  it("recognises CFD finding rows by the CFD overlay root prim path only", () => {
    expect(rows.map(isCfdIssue)).toEqual([false, false, true, false]);
  });

  it("filters by kind, by CFD origin, or not at all", () => {
    expect(filterIssues(rows, "all").map((row) => row.id)).toEqual(["a", "b", "c", "d"]);
    expect(filterIssues(rows, "issue").map((row) => row.id)).toEqual(["a"]);
    expect(filterIssues(rows, "annotation").map((row) => row.id)).toEqual(["b", "c", "d"]);
    expect(filterIssues(rows, "cfd").map((row) => row.id)).toEqual(["c"]);
  });

  it("returns a new array for 'all' so callers can slice without touching the source", () => {
    const all = filterIssues(rows, "all");
    expect(all).not.toBe(rows);
    expect(all).toEqual(rows);
  });
});
