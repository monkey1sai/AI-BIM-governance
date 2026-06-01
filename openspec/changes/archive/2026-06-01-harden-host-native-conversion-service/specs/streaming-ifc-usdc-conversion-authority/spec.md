# streaming-ifc-usdc-conversion-authority — Spec Delta (harden-host-native-conversion-service)

> Delta against `openspec/specs/streaming-ifc-usdc-conversion-authority/spec.md`。
> 補強既有「Conversion failures expose actionable diagnostic」requirement：把 HOOPS / Kit 失敗時的 log path 抽取，從脆弱的 prose regex 改為結構化 sentinel，使 ps1 訊息格式變動不再導致 operator 拿不到 log path。

## ADDED Requirements

### Requirement: Conversion failure log paths SHALL be extracted via a structured sentinel

當 PowerShell / Kit / HOOPS 轉檔失敗時，conversion adapter SHALL 透過 converter 腳本 emit 的結構化 sentinel（單行 JSON，前綴 `##CONV_META##`）抽取診斷用 log path（`kit_stdout_log` / `kit_stderr_log`），而非僅依賴對人類可讀 prose 的 regex 比對。當 sentinel 缺失或 JSON 損壞時，adapter SHALL fallback 為空 metadata 且 MUST NOT 因解析失敗而拋出非預期例外；`result.error` 的既有欄位形狀 SHALL 保持不變。Converter 腳本 MAY 同時保留人類可讀的 prose 行供 operator 閱讀。

#### Scenario: Structured sentinel yields log paths

- **WHEN** converter 腳本在失敗（或成功）路徑 emit 一行 `##CONV_META##` 單行 JSON，內含 `kit_stdout_log` 與 `kit_stderr_log`
- **AND** adapter 解析 combined stdout/stderr
- **THEN** adapter SHALL 從該 sentinel JSON 抽出 log path（含 Windows `C:\\` 絕對路徑）
- **AND** SHALL 把它們放進 `result.error` 既有的 `kit_stdout_log` / `kit_stderr_log` 欄位

#### Scenario: Missing or corrupt sentinel degrades safely

- **WHEN** converter 輸出含人類可讀 prose 但無 `##CONV_META##` sentinel，或 sentinel JSON 損壞無法解析
- **THEN** adapter SHALL 回傳空 metadata（log path 缺省）
- **AND** SHALL NOT 因解析失敗而拋出非預期例外
- **AND** conversion 失敗診斷的其餘既有欄位 SHALL 維持不變
