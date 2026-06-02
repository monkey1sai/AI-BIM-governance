// Edge Console 單一真相源（移植自設計原型，誠實 provenance 系統）。
// 不放任何願景假數字；每個區塊 / 應用都標真實 provenance 與 phase。

export type Prov = "asbuilt" | "artifact" | "demo" | "p1" | "p15";

export const PROV_LABEL: Record<Prov, string> = {
  asbuilt: "已實作",
  artifact: "實測 artifact",
  demo: "示範資料",
  p1: "後端待建 · P1",
  p15: "後端待建 · P1.5",
};

export const PROV_CLASS: Record<Prov, string> = {
  asbuilt: "ec-asbuilt",
  artifact: "ec-artifact",
  demo: "ec-demo",
  p1: "ec-p1",
  p15: "ec-p15",
};

export interface PageDef {
  key: string;
  no: string;
  label: string;
  plane: "governance" | "omniverse";
}

// 兩段式導覽（雲地邊界視覺化）：Governance Platform（零 GPU）/ Omniverse Runtime（綁 GPU）。
export const PAGES: PageDef[] = [
  { key: "overview", no: "A", label: "Overview", plane: "governance" },
  { key: "coordinator", no: "B", label: "Coordinator Console", plane: "governance" },
  { key: "intake", no: "C", label: "Model Intake", plane: "governance" },
  { key: "issues", no: "D", label: "Issues · 語意驗收 / Rule Center", plane: "governance" },
  { key: "apps", no: "E", label: "Applications · A1–A10", plane: "governance" },
  { key: "runtime", no: "F", label: "Runtime Dashboard", plane: "omniverse" },
  { key: "review", no: "G", label: "Review Room", plane: "omniverse" },
  { key: "semantic", no: "H", label: "Semantic Viewer", plane: "omniverse" },
];

export interface AppCardDef {
  code: string;
  slug: string;
  title: string;
  en: string;
  phase: number;
  tier: "focus" | "roadmap";
  dep: string;
  prov: Prov;
  route?: string; // 內部 console route（有 = 可點）
}

// A1–A10 權威清單（轉述自設計原型 roadmap-data.jsx RM_APPS）。
// 本 repo 落地狀態：A1 backend AS-BUILT（PR #151）；A2/A3 為前端骨架 + spec（p1）；A4–A10 roadmap。
export const A1A10: AppCardDef[] = [
  { code: "A1", slug: "governance", title: "BIM 治理與模型檢核", en: "Governance & Rule Checker", phase: 1, tier: "focus", dep: "core+omni", prov: "asbuilt", route: "issues" },
  { code: "A2", slug: "version-diff", title: "模型版本差異與責任追蹤", en: "Model Version Diff", phase: 2, tier: "focus", dep: "core", prov: "asbuilt", route: "version-diff" },
  { code: "A3", slug: "federation", title: "跨專業模型 Federation", en: "Cross-discipline Federation", phase: 2, tier: "focus", dep: "omni", prov: "p1", route: "federation" },
  { code: "A4", slug: "ai-search", title: "語意搜尋與模型問答", en: "USD Search & NL Query", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A5", slug: "iot-fm", title: "IoT / BMS / FM 數位分身", en: "IoT / FM Digital Twin", phase: 3, tier: "roadmap", dep: "core+omni", prov: "p15" },
  { code: "A6", slug: "4d-5d", title: "4D / 5D 施工模擬", en: "4D / 5D Construction", phase: 2, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A7", slug: "reality-capture", title: "Reality Capture 比對", en: "Scan-to-BIM Deviation", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A8", slug: "synthetic-data", title: "Synthetic Data Studio", en: "Synthetic Data Studio", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A9", slug: "usd-copilot", title: "USD Code / ChatUSD", en: "USD Code Copilot", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
  { code: "A10", slug: "robot-sim", title: "機器人 / 無人機巡檢", en: "Robot / Drone Sim", phase: 4, tier: "roadmap", dep: "omni", prov: "p15" },
];
