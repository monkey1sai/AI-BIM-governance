// 相機水平朝向 → 相對「專案北」的方位角。模型座標：+Y 為專案北、+X 為專案東、Z 朝上
// （與 Kit cfd_pipeline/wind.py 同一約定）。IFC 真北未接入前，這不是真實方位（docs/plans/building-energy-cfd.md R1、§10.1）。

export interface CompassCameraInput {
  /** 相機視線方向（世界座標，Kit camera-state/v1 的 `direction`）。 */
  direction: readonly number[];
  /** 相機螢幕上方方向（`up`）；視線近乎垂直（俯視）時用它決定畫面上方朝哪。 */
  up: readonly number[];
}

// 視線的水平分量小於此值即視為垂直俯／仰視（Kit 回報的 direction 已正規化）。
const VERTICAL_EPSILON = 1e-3;

function horizontalBearing([x, y]: readonly number[]): number | null {
  if (Math.hypot(x, y) < VERTICAL_EPSILON) return null;
  const degrees = (Math.atan2(x, y) * 180) / Math.PI;
  // 正規化到 [0, 360)，並把 -0 與浮點誤差造成的 360 收回 0。
  const normalized = ((degrees % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized + 0;
}

/**
 * 相機水平視線相對專案北（+Y）的順時針角度（度）。
 * 俯視（視線近乎垂直）時改用 `up` 的水平分量，也就是「畫面上方」朝哪；兩者都退化時回 null。
 */
export function headingFromCamera({ direction, up }: CompassCameraInput): number | null {
  const wellFormed = (vector: readonly number[]) => vector.length >= 2 && vector.every(Number.isFinite);
  if (!wellFormed(direction) || !wellFormed(up)) return null;
  return horizontalBearing(direction) ?? horizontalBearing(up);
}
