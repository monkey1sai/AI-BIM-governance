// web-viewer-sample/src/console/governance/govEndpoints.ts
// MVP 強制 identity profile = guid_exact、coverage = 1.0（Q4）。coverage<90% 觸發降級時，
// 依既有 spec 誠實降級（不捏造、不冒充 guid_exact、不引入新引擎）：
//  - host-native-conversion-authority-service：未對映 entity 報 unmapped/sidecar-only/omitted。
//  - runtime-verification-evidence：measure-first，誠實報 coverage，低覆蓋 warn 不 fail；
//    threshold lock 後 minimum_coverage_ratio=1.0、coverage_denominator=source_ifc_entity_count。
//  - governance-rule-run-authority：不把非 guid_exact 當 guid_exact；fake/smoke 不算真實覆蓋。
export const MVP_IDENTITY_PROFILE = "guid_exact" as const;
export const MVP_MIN_COVERAGE = 1.0 as const;
export const MVP_COVERAGE_DENOMINATOR = "source_ifc_entity_count" as const;
// 低覆蓋 fallback 觸發閾值（<90%）；MVP 強制 1.0 多半不觸發。
export const LOW_COVERAGE_THRESHOLD = 0.9 as const;

export interface CoverageGateInput {
  coverageRatio: number | null; // 來自 MappingCache.coverageRatio()
  isFake: boolean;
}

export interface CoverageGateResult {
  coverageOk: boolean; // 是否達 MVP_MIN_COVERAGE（1.0）
  degraded: boolean;   // 是否進入誠實降級路徑
  warnOnly: boolean;   // measure-first：低覆蓋 warn 不 fail
  profile: typeof MVP_IDENTITY_PROFILE;
  denominator: typeof MVP_COVERAGE_DENOMINATOR;
}

export function evaluateCoverageGate(input: CoverageGateInput): CoverageGateResult {
  const base = { profile: MVP_IDENTITY_PROFILE, denominator: MVP_COVERAGE_DENOMINATOR } as const;
  if (input.isFake || input.coverageRatio === null) {
    // fake / 未知覆蓋：不可信 → 降級（warn 不 fail），不假裝 1.0。
    return { ...base, coverageOk: false, degraded: true, warnOnly: true };
  }
  const coverageOk = input.coverageRatio >= MVP_MIN_COVERAGE;          // locked 1.0 = pass
  const degraded = input.coverageRatio < LOW_COVERAGE_THRESHOLD;        // fallback path only < 0.9
  return { ...base, coverageOk, degraded, warnOnly: !coverageOk };      // measure-first：低於 locked 1.0 一律 warn
}
