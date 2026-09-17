import { useCallback, useEffect, useRef, useState } from "react";
import { CoordinatorHttpError, isCoordinatorNotFound, type LineageConversionReport } from "../coordinatorClient";
import { t } from "../i18n";

/** 對齊報表各畫面共用的讀取狀態、狀態文字與時間格式。 */
export type Load<T> =
  | { state: "loading" }
  | { state: "error"; status: number | null }
  | { state: "not_found" }
  | { state: "loaded"; value: T };

export const REPORT_STATUS: Record<LineageConversionReport["status"], string> = {
  generated: t("已產出", "Generated"),
  failed: t("報表產生失敗", "Report failed"),
  not_produced: t("未產出報表", "No report produced"),
  invalid: t("報表未通過驗證", "Report failed verification"),
};

/** 取值；fetcher 變動或重試時丟棄過期回應。 */
export function useLoad<T>(fetcher: () => Promise<T>): [Load<T>, () => void] {
  const [load, setLoad] = useState<Load<T>>({ state: "loading" });
  const generation = useRef(0);
  const run = useCallback(() => {
    const current = ++generation.current;
    setLoad({ state: "loading" });
    fetcher().then(
      (value) => { if (current === generation.current) setLoad({ state: "loaded", value }); },
      (error: unknown) => {
        if (current !== generation.current) return;
        setLoad(isCoordinatorNotFound(error)
          ? { state: "not_found" }
          : { state: "error", status: error instanceof CoordinatorHttpError ? error.status : null });
      },
    );
  }, [fetcher]);
  useEffect(() => {
    run();
    return () => { generation.current += 1; };
  }, [run]);
  return [load, run];
}

export function formatWhen(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
