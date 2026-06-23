// 輕量 i18n runtime（zh 預設；en 選用）。
// 設計：inline t("中文","English") 模式 —— t() 於 render 時讀「當前語言」module 變數，
// 殼層 EdgeConsole 呼叫一次 useLang() 訂閱變更 → 語言切換時整棵樹 re-render，t() 重新求值（反應式）。
// 預設 zh，且 en 缺值 fallback zh：故未翻譯處與既有 88 測試（斷言 zh）皆不受影響。
// 不引入 i18n library，不維護中央字典 key。
import { useEffect, useState } from "react";

export type Lang = "zh" | "en";
const KEY = "aibim:ec-lang";

let _lang: Lang = ((): Lang => {
  try { return localStorage.getItem(KEY) === "en" ? "en" : "zh"; } catch { return "zh"; }
})();

const subs = new Set<() => void>();

export function getLang(): Lang { return _lang; }

export function setLang(l: Lang): void {
  if (l === _lang) return;
  _lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  subs.forEach((f) => f());
}

/** render 時呼叫；回傳當前語言字串。en 未提供時 fallback zh（未翻譯處安全顯示中文）。 */
export function t(zh: string, en?: string): string {
  return _lang === "en" && en ? en : zh;
}

/** 殼層訂閱語言變更並觸發 re-render（呼叫一次即可讓整棵 render 樹反應式）。 */
export function useLang(): Lang {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => { subs.delete(f); };
  }, []);
  return _lang;
}
