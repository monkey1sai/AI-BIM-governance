import { t } from '../i18n';
import { controlFeedback } from './controlStyles';
import type { GroundSampling } from './cfdGround';

const metres = (value: number | null) => value === null ? t('未記錄', 'not recorded') : `${value.toFixed(2)} m`;

export function GroundReferenceStatus({ sampling }: { sampling: GroundSampling | null }) {
  return <div data-testid="wind-ground-reference" role="note" tabIndex={0}
    style={{ ...controlFeedback, height: '9em', padding: 6, border: '1px solid var(--ab-border)', borderRadius: 6 }}>
    <strong>{t('行人取樣高度基準', 'Pedestrian sampling reference')}</strong><br />
    {sampling ? <>
      {t('實際地面未核對；不能視為全場距地 1.5 m。', 'Actual ground unverified; not proof of 1.5 m above site surfaces.')}<br />
      {t('計算地面 Z：', 'Calculation ground Z: ')}{metres(sampling.calculationGroundM)}<br />
      {t('取樣 Z：', 'Sample Z: ')}{metres(sampling.samplingZ)} · {t('高於計算地面：', 'Above calculation ground: ')}{metres(sampling.aboveCalculationGroundM)}<br />
      {t('箭頭顯示抬升：', 'Vector display lift: ')}{metres(sampling.displayLiftM)}
    </> : t('套用疊圖並取得 Kit 確認後，顯示該結果的高度基準。', 'Apply the overlay and obtain Kit confirmation to show that result’s height reference.')}
  </div>;
}
