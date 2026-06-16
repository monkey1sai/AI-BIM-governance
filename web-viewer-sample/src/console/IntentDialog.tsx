import { useRef } from "react";

// conv-prioritize-retry:模式 3（intent→confirm）首個 controlled-action 共用 modal。
// 非樂觀：confirm 後 await onConfirm；成功與否由呼叫端決定關閉（POST 成功才關）。
// 使用 uncontrolled textarea（ref）而非 controlled（value+onChange），以確保測試環境
// 直接 DOM 設值後 ref.current.value 仍可讀到最新內容。
export function IntentDialog({
  open, title, cost, onConfirm, onCancel, busy,
}: {
  open: boolean;
  title: string;
  cost: string;
  /**
   * 確認時呼叫，帶使用者填的 reason。caller 負責 UI 反饋：失敗時須自行 catch 並
   * setErr + 解除 busy（規格 §5/§4.6：失敗顯誠實錯誤、不改狀態、不關 dialog）。
   * 本 component 不顯示錯誤、不關 dialog；只在 click handler 內 await 並吞掉 rejection，
   * 作為防 unhandledrejection 的安全網，避免 caller 漏 catch 時錯誤無聲逸散。
   */
  onConfirm: (reason: string) => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}) {
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  if (!open) return null;
  return (
    <div className="ec-modal-backdrop" data-testid="intent-dialog">
      <div className="ec-modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        <p className="ec-warn-note">{cost}</p>
        <label className="ec-field-k" htmlFor="intent-reason">原因（可空）</label>
        <textarea
          id="intent-reason"
          className="ec-input"
          ref={reasonRef}
          defaultValue=""
          disabled={busy}
          rows={2}
        />
        <div className="ec-modal-actions">
          <button className="ec-btn" disabled={busy} onClick={onCancel} data-testid="intent-cancel">取消</button>
          <button
            className="ec-btn primary"
            disabled={busy}
            onClick={async () => {
              // 安全網：await 並吞掉 rejection，防 unhandledrejection。
              // UI 反饋（顯示錯誤、解除 busy）由 caller 在 onConfirm 內自行處理。
              try { await onConfirm(reasonRef.current?.value ?? ""); } catch { /* caller 負責反饋 */ }
            }}
            data-testid="intent-confirm"
          >
            {busy ? "執行中…" : "確認執行"}
          </button>
        </div>
      </div>
    </div>
  );
}
