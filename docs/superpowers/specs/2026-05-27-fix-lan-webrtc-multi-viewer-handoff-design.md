# fix-lan-webrtc-multi-viewer-handoff Design

## Summary

使用者確認採用 A 方案：同一個已轉檔 `review_session_id` 至少兩個 browser clients 同時觀看同一個 Kit/WebRTC 畫面，並修正 `/ui/open` 把 LAN client 導到 `127.0.0.1` 的問題。

## Brainstorming Outcome

推薦路徑是 same-session / same-Kit first：

- 先把 coordinator handoff URL 改成 browser-visible。
- viewer 從 handoff query 取得 `coordinatorApiBase` / `coordinatorSocketUrl`。
- 兩個 viewers 加入同一 `review_session_id`，證明 participant/viewer count、WebRTC lifecycle、stage URL match。
- 只把 `single_kit_multi_viewer` 標成 pass；不宣稱 dedicated multi-Kit pass。

## Non-Goals

- 不做 dedicated multi-Kit / 多 GPU 排程。
- 不恢復已退役的 issue / annotation collaboration UI。
- 不把 Webwright 加進 production dependency。

## Verification

Final validation 必須包含 Microsoft Webwright local checkout / install，以及用 Webwright/Playwright 產生的 two-viewer screenshot artifacts。
