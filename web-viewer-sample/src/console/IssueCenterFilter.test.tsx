import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IssuesRuleCenterPage } from "./pages";
import { governanceClient, type IssueRow } from "./governanceClient";
import { getLang, setLang } from "./i18n";

// Issue Center：進頁自動載入既有 issue；篩選在 30 筆上限之前套用，CFD 風環境 annotation 不會被大量 rule-run issue 擠掉。

let root: Root;
let box: HTMLDivElement;
const previousLang = getLang();

const ruleIssue = (n: number): IssueRow => ({
  id: `iss_rule_${n}`, kind: "issue", title: `Doors need FireRating #${n}`, status: "open", severity: "required",
  ifc_guid: `guid_${String(n).padStart(3, "0")}`, usd_prim_path: `/World/Model/Door_${n}`, source_type: "rule_result",
});
const cfdAnnotation = (deg: number, u: number): IssueRow => ({
  id: `iss_cfd_${deg}`, kind: "annotation", title: `CFD 風環境 ${deg}°：行人面 |U|max ${u.toFixed(2)} m/s > 4.4 m/s（screening，設計比較用）`,
  status: "open", severity: "medium", ifc_guid: null,
  usd_prim_path: "/World/Overlays/Cfd/cfd_20260922T082409Z_abcdef/PedestrianWind_1p5m", source_type: "manual",
});
// 35 rule-run issues first, the two CFD annotations last: under "all" they fall outside the 30-row cap.
const ROWS: IssueRow[] = [...Array.from({ length: 35 }, (_, i) => ruleIssue(i + 1)), cfdAnnotation(135, 4.48), cfdAnnotation(157.5, 4.42)];

async function flush(ticks = 6) {
  for (let i = 0; i < ticks; i += 1) await act(async () => { await Promise.resolve(); });
}
const $ = <T extends HTMLElement>(selector: string) => box.querySelector<T>(selector);
const tableTitles = () => Array.from(box.querySelectorAll('[data-testid="issues-table"] tbody tr')).map((tr) => tr.children[4]?.textContent ?? "");
const select = async (value: string) => {
  const el = $<HTMLSelectElement>('[data-testid="issues-filter"]')!;
  await act(async () => { el.value = value; el.dispatchEvent(new Event("change", { bubbles: true })); });
};

beforeEach(() => {
  setLang("zh");
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(governanceClient, "filesTree").mockResolvedValue({ root: "", source_kind: "local_fs", projects: [] } as unknown as Awaited<ReturnType<typeof governanceClient.filesTree>>);
  vi.spyOn(governanceClient, "listIssues").mockResolvedValue(ROWS);
  box = document.createElement("div");
  document.body.append(box);
  root = createRoot(box);
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
  vi.restoreAllMocks();
  setLang(previousLang);
});

describe("Issue Center filter", () => {
  it("loads existing issues on mount without pressing 載入 issues", async () => {
    act(() => root.render(<IssuesRuleCenterPage />));
    await flush();
    expect(governanceClient.listIssues).toHaveBeenCalledTimes(1);
    expect(governanceClient.listIssues).toHaveBeenCalledWith();
    expect($('[data-testid="issues-count"]')!.textContent).toContain("顯示 30／符合 37／共 37 筆");
    expect(tableTitles()).toHaveLength(30);
    // Under "all" the two CFD annotations are past the cap.
    expect(tableTitles().some((title) => title.startsWith("CFD 風環境"))).toBe(false);
  });

  it("the CFD filter lists only the CFD wind annotations, applied before the 30-row cap", async () => {
    act(() => root.render(<IssuesRuleCenterPage />));
    await flush();
    await select("cfd");
    expect($('[data-testid="issues-count"]')!.textContent).toContain("顯示 2／符合 2／共 37 筆");
    expect(tableTitles()).toEqual([ROWS[35].title, ROWS[36].title]);
    const kinds = Array.from(box.querySelectorAll('[data-testid="issues-table"] tbody tr')).map((tr) => tr.children[0]?.textContent);
    expect(kinds).toEqual(["annotation", "annotation"]);
  });

  it("kind filters split formal issues from annotations; switching back to all restores the cap", async () => {
    act(() => root.render(<IssuesRuleCenterPage />));
    await flush();
    await select("issue");
    expect($('[data-testid="issues-count"]')!.textContent).toContain("顯示 30／符合 35／共 37 筆");
    expect(tableTitles().every((title) => title.startsWith("Doors need FireRating"))).toBe(true);
    await select("annotation");
    expect($('[data-testid="issues-count"]')!.textContent).toContain("顯示 2／符合 2／共 37 筆");
    await select("all");
    expect(tableTitles()).toHaveLength(30);
  });

  it("while the first load is in flight it says loading, not 0", async () => {
    let resolve: (rows: IssueRow[]) => void = () => {};
    vi.mocked(governanceClient.listIssues).mockReturnValueOnce(new Promise<IssueRow[]>((r) => { resolve = r; }));
    act(() => root.render(<IssuesRuleCenterPage />));
    await flush();
    const count = $('[data-testid="issues-count"]')!;
    expect(count.getAttribute("data-state")).toBe("loading");
    expect(count.textContent).toContain("讀取 issues 中");
    expect(count.textContent).not.toContain("共 0 筆");
    await act(async () => { resolve(ROWS); });
    await flush();
    expect(count.getAttribute("data-state")).toBe("live");
    expect(count.textContent).toContain("共 37 筆");
  });

  it("an unavailable governance is reported as not retrieved, never as 0 issues", async () => {
    vi.mocked(governanceClient.listIssues).mockRejectedValueOnce(new Error("governance offline"));
    act(() => root.render(<IssuesRuleCenterPage />));
    await flush();
    const count = $('[data-testid="issues-count"]')!;
    expect(count.getAttribute("data-state")).toBe("error");
    expect(count.getAttribute("role")).toBe("alert");
    expect(count.textContent).toContain("issues 未取得：governance offline");
    expect(count.textContent).not.toContain("共 0 筆");
    expect(box.querySelector('[data-testid="issues-table"]')).toBeNull();
  });
});
