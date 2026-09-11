import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Btn, Field, HealthChip, Panel, ProvLegend, ProvTag } from "./components";
import EdgeConsole from "./EdgeConsole";
import type { Prov } from "./data";
import { getLang, setLang } from "./i18n";

describe("human-facing shared console presentation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let previousLang: ReturnType<typeof getLang>;
  let previousUrl: string;
  let previousAct: unknown;
  async function render(node: React.ReactNode) {
    await act(async () => { root.render(node); });
  }
  beforeEach(() => {
    previousLang = getLang();
    previousUrl = window.location.href;
    previousAct = (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT;
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    setLang("zh");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
    setLang(previousLang);
    window.history.replaceState(null, "", previousUrl);
    (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = previousAct;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each<Prov>(["asbuilt", "artifact"])(
    "%s retains machine provenance without visible or accessible implementation badges",
    async (prov) => {
      await render(<ProvTag prov={prov} />);
      const tag = container.querySelector<HTMLElement>("[data-prov]");
      expect(tag?.dataset.prov).toBe(prov);
      expect(tag?.hidden).toBe(true);
      expect(tag?.getAttribute("aria-hidden")).toBe("true");
      // The legacy .ec-prov display rule must not reveal a hidden tag.
      expect(getComputedStyle(tag!).display).toBe("none");
      expect(tag?.textContent).toBe("");
    },
  );

  it.each(["p1", "p15", "p3", "p4"] as const)("keeps %s availability visible without implementation phase labels", async (prov) => {
    for (const lang of ["zh", "en"] as const) {
      setLang(lang);
      await render(<ProvTag prov={prov} />);
      const tag = container.querySelector<HTMLElement>("[data-prov]")!;
      expect(tag.hidden).toBe(false);
      expect(tag.getAttribute("aria-hidden")).not.toBe("true");
      expect(getComputedStyle(tag).display).not.toBe("none");
      const pending = prov === "p1" || prov === "p15";
      expect(tag.textContent).toBe(lang === "zh"
        ? pending ? "尚未提供" : "規劃中"
        : pending ? "Not available yet" : "Planned");
      expect(tag.textContent).not.toMatch(/P[134]|Phase|Backend/);
    }
  });

  it.each(["zh", "en"] as const)("demo data stays visible and accessible in %s", async (lang) => {
    setLang(lang);
    await render(<ProvTag prov="demo" />);
    const tag = container.querySelector<HTMLElement>('[data-prov="demo"]')!;
    expect(tag.hidden).toBe(false);
    expect(tag.getAttribute("aria-hidden")).not.toBe("true");
    expect(getComputedStyle(tag).display).not.toBe("none");
    expect(tag.textContent).toBe(lang === "zh" ? "示範資料" : "DEMO DATA");
  });

  it.each(["zh", "en"] as const)("health remains observed state; demo never looks live in %s", async (lang) => {
    setLang(lang);
    await render(<><HealthChip name="Kit" state="unavailable" prov="asbuilt" />
      <HealthChip name="Example" state="ready" prov="demo" /></>);
    const live = container.querySelector<HTMLElement>('[data-prov="asbuilt"]')!;
    const demo = container.querySelector<HTMLElement>('[data-prov="demo"]')!;
    expect(live.textContent).toBe("Kit:unavailable");
    expect(live.hidden).toBe(false);
    expect(live.title).not.toMatch(/as-built|已實作|P[134]/i);
    expect(demo.textContent).toContain("Example:ready");
    expect(demo.textContent).toContain(lang === "zh" ? "示範資料" : "DEMO DATA");
  });

  it("keeps action callbacks, disabled prevention, reasons and data alongside hidden metadata", async () => {
    const onOpen = vi.fn();
    const onDenied = vi.fn();
    await render(<Panel title="審查紀錄" prov="artifact">
      <Field k="服務狀態" v="服務暫時無法使用，請稍後重試" prov="asbuilt" />
      <Btn data-testid="open" prov="asbuilt" caption="開啟所選紀錄" onClick={onOpen}>開啟</Btn>
      <Btn data-testid="denied" prov="p1" disabled title="目前沒有確認權限"
        caption="請聯絡專案管理者" onClick={onDenied}>確認整改</Btn>
    </Panel>);
    const open = container.querySelector<HTMLButtonElement>('[data-testid="open"]')!;
    const denied = container.querySelector<HTMLButtonElement>('[data-testid="denied"]')!;
    await act(async () => { open.click(); denied.click(); });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onDenied).not.toHaveBeenCalled();
    expect(denied.disabled).toBe(true);
    expect(denied.title).toBe("目前沒有確認權限");
    expect(denied.textContent).toContain("請聯絡專案管理者");
    expect(container.textContent).toContain("服務暫時無法使用，請稍後重試");
    expect(container.querySelectorAll("[data-prov]").length).toBe(4);
  });

  it("explains demo and traceable report sources without promising validation from a badge", async () => {
    await render(<ProvLegend />);
    expect(container.textContent).toContain("資料來源");
    expect(container.textContent).toContain("示範資料");
    expect(container.textContent).toContain("審查紀錄");
    expect(container.textContent).not.toMatch(/已寫好|真的能用|已實作|後端未建|Phase|P1/);
  });

  it("legacy shell keeps real navigation and language without ghost Agent or progress controls", async () => {
    // Explicit unavailable API response: this DOM test proves navigation only,
    // never a real backend, successful operation, lease or GPU frame.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false, status: 503, json: async () => ({ error: "service_unavailable" }),
      text: async () => "service_unavailable",
    }));
    window.history.replaceState(null, "", "#overview");
    await render(<EdgeConsole />);
    expect(container.querySelector(".ec-root.ec-agent-collapsed")).not.toBeNull();
    expect(container.querySelector(".ec-agent")).toBeNull();
    expect(container.querySelector(".ec-tweaks")).toBeNull();
    expect(container.querySelector(".ec-nav-badge")).toBeNull();
    expect(container.querySelector(".ec-top")?.textContent).not.toMatch(/Agent|8004|49102/);
    expect(container.querySelector(".ec-foot")?.textContent).not.toMatch(/MVP|as-built/);
    const steps = container.querySelectorAll<HTMLButtonElement>(".ec-flow-step");
    expect(steps.length).toBe(5);
    expect(steps[3].dataset.prov).toBe("p15");
    expect(steps[3].title).toBe("標記問題位置");
    expect(steps[3].classList.contains("p15")).toBe(false);
    const english = Array.from(container.querySelectorAll<HTMLButtonElement>(".ec-langtoggle button"))
      .find((button) => button.textContent === "EN")!;
    await act(async () => { english.click(); });
    expect(english.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll<HTMLButtonElement>(".ec-flow-step")[3].title).toBe("Mark");
    const sessions = container.querySelector<HTMLButtonElement>('.ec-nav button[title="Session ATC"]')!;
    expect(sessions).not.toBeNull();
    await act(async () => { sessions.click(); });
    expect(window.location.hash).toBe("#sessions");
    expect(container.querySelector('.ec-nav button[title="Session ATC"]')?.classList.contains("active")).toBe(true);
    expect(container.querySelectorAll("iframe").length).toBe(0);
  });
});
