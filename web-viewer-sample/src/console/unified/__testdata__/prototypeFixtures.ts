// 設計原型（scratchpad/design-origin/app.js）的假資料 export——unified-console-runtime-truth slice 1（D1=P）自
// production 的 ./fixtures 搬出，只供測試作負向 oracle（fixtureNotInProduction.test.ts：畫面不得出現這些固定值）。
// production 元件不得 import 本檔（同一測試守門）。
import type { ConvItem, IntakeItem, IssueItem, OutboxItem, SessionItem } from "../fixtures";

export const initialIntake: IntakeItem[] = [
  { file: "demo_lib_2026.ifc", src: "MinIO bucket/incoming" },
  { file: "松風庵_v3.ifc", src: "MinIO bucket/incoming" },
];

export const initialConv: ConvItem[] = [
  { file: "990_model.ifc", st: "running" },
  { file: "fixture-bytes.ifc", st: "failed" },
  { file: "許良宇圖書館建築_2026.ifc", st: "done", metrics: "12.4M tris · 98%" },
];

export const initialSessions: SessionItem[] = [
  { id: "S-240601", lease: "editor lease", stage: "/Review/A1_Tower_fed.usd" },
];

export const initialOutbox: OutboxItem[] = [
  { id: "OB-201", kind: "conversion-result", st: "待送" },
  { id: "OB-202", kind: "issue-snapshot", st: "待送" },
  { id: "OB-200", kind: "conversion-result", st: "已送" },
];

export const initialIssues: IssueItem[] = [
  { id: "ISS-101", title: "FD-4F-02 防火時效不足(30min < 60min)", st: "open", src: "rule-run #87" },
  { id: "ISS-098", title: "B-3F-12 樑位移 +42mm 超容差", st: "in-review", src: "diff v11→v12" },
];

/* ── ops 服務健康 6 項（原型固定 ok:true）── */
export interface ServiceDef { name: string; port: string; ok: boolean; }
export const services: ServiceDef[] = [
  { name: "bim-review-coordinator", port: ":8004", ok: true },
  { name: "governance-service", port: ":49102", ok: true },
  { name: "conversion authority", port: ":49101", ok: true },
  { name: "Kit signaling / WebRTC", port: ":49100 / :47998", ok: true },
  { name: "kit-manager-api", port: ":8010", ok: true },
  { name: "MinIO watch", port: "s3 events", ok: true },
];

/* ── home 警示 / 事件 4 項 ── */
export interface AlertDef { msgZh: string; msgEn: string; t: string; c: string; }
export const alerts: AlertDef[] = [
  { msgZh: "rule-run #88 完成:嚴重 18 項", msgEn: "rule-run #88 done: 18 critical", t: "10:53", c: "var(--ab-danger)" },
  { msgZh: "990_model.ifc 轉檔完成,品質 98%", msgEn: "990_model.ifc converted, quality 98%", t: "10:20", c: "var(--ab-ok)" },
  { msgZh: "Outbox OB-201 重試 ×2", msgEn: "Outbox OB-201 retry ×2", t: "10:41", c: "var(--ab-warn)" },
  { msgZh: "S-240601 first-frame 1.84s", msgEn: "S-240601 first-frame 1.84s", t: "10:53", c: "var(--ab-accent)" },
];
