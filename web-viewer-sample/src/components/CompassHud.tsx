import { useSyncExternalStore } from "react";
import { t } from "../console/i18n";
import type { CompassSnapshot } from "./compassCameraFeed";
import "./CompassHud.css";

// 真北來源未記錄前，UI 只能顯示「相對 project north」的方位（docs/plans/building-energy-cfd-p2-contract.md R-A3）。
const EXPLANATION: [string, string] = [
  "方位以模型 +Y 為專案北；IFC 真北未接入時不代表真實方位",
  "Bearing uses model +Y as project north; without IFC true north it is not a real-world bearing",
];

const LETTER_RADIUS = 29;
const LETTERS = [
  { key: "n", label: "N", x: 0, y: -LETTER_RADIUS },
  { key: "e", label: "E", x: LETTER_RADIUS, y: 0 },
  { key: "s", label: "S", x: 0, y: LETTER_RADIUS },
  { key: "w", label: "W", x: -LETTER_RADIUS, y: 0 },
] as const;
const TICKS = [45, 135, 225, 315] as const;

export interface CompassHudProps {
  /** 相機水平朝向，專案北起順時針的度數；null 表示尚未取得。 */
  heading: number | null;
  /** HUD 已送出的相機讀取筆數（照實揭露在 data-reads；這些讀取不進 DataChannel 診斷紀錄）。 */
  reads?: number;
}

/**
 * 3D 舞台左下角的專案北羅盤。整個羅盤轉 -heading，讓相機正看著的方位字母落在最上方（固定指標處）；
 * 字母各自反轉回正，保持直立可讀。只顯示、不接收指標事件。
 */
export function CompassHud({ heading, reads = 0 }: CompassHudProps) {
  const reading = heading !== null && Number.isFinite(heading) ? heading : null;
  const known = reading !== null;
  const turn = reading ?? 0;
  const rounded = reading === null ? null : Math.round(reading) % 360;
  const explanation = t(...EXPLANATION);
  const summary = rounded === null
    ? t("方位未取得。", "Bearing unavailable. ")
    : t(`相機朝向：專案北順時針 ${rounded}°。`, `Camera heading ${rounded}° clockwise from project north. `);
  return (
    <div
      className="gv-compass"
      data-testid="viewer-compass"
      data-heading={rounded === null ? "" : String(rounded)}
      data-state={known ? "known" : "unknown"}
      data-reads={String(reads)}
      role="img"
      aria-label={`${summary}${explanation}`}
    >
      <svg className="gv-compass__dial" viewBox="-50 -50 100 100" aria-hidden="true" focusable="false">
        <circle className="gv-compass__face" r="46" />
        <path className="gv-compass__marker" d="M0 -49 L5 -42 L-5 -42 Z" />
        <g data-testid="viewer-compass-rose" transform={`rotate(${-turn})`}>
          {TICKS.map((angle) => (
            <line key={angle} className="gv-compass__tick" x1="0" y1="-40" x2="0" y2="-35" transform={`rotate(${angle})`} />
          ))}
          {LETTERS.map((letter) => (
            <text
              key={letter.key}
              data-testid={letter.key === "n" ? "viewer-compass-n" : undefined}
              className={letter.key === "n" ? "gv-compass__letter gv-compass__letter--n" : "gv-compass__letter"}
              x={letter.x}
              y={letter.y}
              transform={`rotate(${turn} ${letter.x} ${letter.y})`}
            >
              {letter.label}
            </text>
          ))}
        </g>
      </svg>
      <span className="gv-compass__caption">{known ? t("專案北", "project N") : t("方位未取得", "bearing unknown")}</span>
    </div>
  );
}

/** 讀數來源（CompassCameraFeed）的最小介面。 */
export interface CompassSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): CompassSnapshot;
}

/** 直接訂閱讀數來源：相機讀數更新只重繪羅盤，不重繪整個 viewer。 */
export function CompassHudLive({ source }: { source: CompassSource }) {
  const snapshot = useSyncExternalStore(source.subscribe, source.getSnapshot);
  return <CompassHud heading={snapshot.heading} reads={snapshot.reads} />;
}
