import { t } from "../i18n";
import type { ResultProgress } from "./AlignmentResultSection";
import type { ConvertProgress } from "./ReconversionPanel";

/**
 * 模型庫的三個步驟：① 選擇模型 → ② 轉檔成 USDC → ③ 檢查對齊結果。
 * 每一步只給一個狀態與一句「現在該做什麼」，讓使用者不用讀說明也知道下一步。
 */
export type StepState = "done" | "active" | "waiting" | "attention" | "todo";
export type StepView = {
  key: "select" | "convert" | "result";
  number: string;
  title: string;
  state: StepState;
  status: string;
  hint: string;
};

export function deriveWorkflowSteps({
  selectedName,
  convert,
  result,
  resultLabel,
}: {
  selectedName: string | null;
  convert: ConvertProgress | null;
  result: ResultProgress | null;
  resultLabel?: string;
}): StepView[] {
  const select: StepView = selectedName
    ? { key: "select", number: "①", title: t("選擇模型", "Pick a model"), state: "done", status: t("已選擇", "Selected"), hint: selectedName }
    : {
      key: "select", number: "①", title: t("選擇模型", "Pick a model"), state: "active", status: t("尚未選擇", "Not selected"),
      hint: t("在左側資料夾點一個 model.ifc", "Open a folder on the left and pick a model.ifc"),
    };

  const convertTitle = t("轉檔成 USDC", "Convert to USDC");
  const convertStep = ((): StepView => {
    const base = { key: "convert" as const, number: "②", title: convertTitle };
    if (!selectedName || convert === null) {
      return { ...base, state: "todo", status: t("未開始", "Not started"), hint: t("選好模型後，在這裡把 IFC 轉成 USDC", "After picking a model, convert its IFC to USDC here") };
    }
    switch (convert) {
      case "loading": return { ...base, state: "waiting", status: t("讀取中", "Loading"), hint: t("正在讀取這個模型的轉檔紀錄", "Reading this model's conversion history") };
      case "error": return { ...base, state: "attention", status: t("無法讀取", "Unavailable"), hint: t("轉檔紀錄暫時讀不到，按「重新整理結果」再試", "The history is unavailable; press Refresh results to retry") };
      case "none": return { ...base, state: "active", status: t("尚未轉檔", "Not converted"), hint: t("按「開始轉檔」把 IFC 轉成 USDC", "Press Start conversion to turn the IFC into USDC") };
      case "running": return { ...base, state: "waiting", status: t("轉檔中", "Converting"), hint: t("完成後畫面會自動更新", "The page updates by itself when it finishes") };
      case "ready": return { ...base, state: "done", status: t("已完成", "Done"), hint: t("需要用新版轉檔器時，可按「重新轉檔」", "Press Reconvert to use the deployed converter again") };
      case "failed": return { ...base, state: "attention", status: t("失敗", "Failed"), hint: t("看轉檔區的失敗原因，處理後再轉一次", "Check the failure reason below, fix it and convert again") };
    }
  })();

  const resultTitle = t("檢查對齊結果", "Check the alignment");
  const resultStep = ((): StepView => {
    const base = { key: "result" as const, number: "③", title: resultTitle };
    if (!selectedName || result === null) {
      return {
        ...base, state: "todo", status: t("未開始", "Not started"),
        hint: t("轉檔完成後，這裡會告訴你 RVT、IFC、USDC 對不對得上", "After conversion, this tells you whether RVT, IFC and USDC line up"),
      };
    }
    switch (result) {
      case "loading": return { ...base, state: "waiting", status: t("讀取中", "Loading"), hint: t("正在讀取對齊結果", "Reading the alignment result") };
      case "error": return { ...base, state: "attention", status: t("無法讀取", "Unavailable"), hint: t("在對齊結果區按「重試」", "Press Retry in the alignment section") };
      case "none": return { ...base, state: "todo", status: t("尚無結果", "No result yet"), hint: t("轉檔完成後會自動產生", "Produced automatically after conversion") };
      case "pending": return { ...base, state: "waiting", status: t("整理中", "Collecting"), hint: t("報表產生中，稍候會自動出現", "The report is being collected and appears shortly") };
      case "generated": return { ...base, state: "done", status: t("已產出", "Ready"), hint: t("看三個比率，點比率卡可看元件清單", "Read the three ratios; select a card to list elements") };
      case "problem": return {
        ...base, state: "attention", status: resultLabel ?? t("無法使用", "Unusable"),
        hint: t("這次轉檔沒有可用的報表；重新轉檔可再產生", "This conversion has no usable report; reconvert to produce one"),
      };
    }
  })();

  return [select, convertStep, resultStep];
}
