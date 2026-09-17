/**
 * 比率以百分比顯示，截斷到小數第二位（與報表「截斷、不四捨五入」的規則一致）。
 * 以分子分母做整數運算，避免 0.5005 × 10000 這類浮點誤差少算一位。
 */
export function formatRatioPercent(metric: { numerator: number; denominator: number }): string {
  if (metric.denominator <= 0) return "—";
  const basisPoints = (BigInt(metric.numerator) * 10_000n) / BigInt(metric.denominator);
  const whole = basisPoints / 100n;
  const fraction = (basisPoints % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}%`;
}
