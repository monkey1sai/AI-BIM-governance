## 1. OpenSpec artifacts（本 change 目錄）

- [x] 1.1 proposal / design / tasks 定稿，spec delta 對 `host-native-conversion-authority-service`（ADD 4 條）與 `streaming-ifc-usdc-conversion-authority`（ADD 1 條）
- [x] 1.2 `npx openspec validate harden-host-native-conversion-service --strict` 通過

## 2. #13 storage sandbox root（先做，影響 adapter 建構契約）

- [x] 2.1 apply 前 `gitnexus_impact` on `Ifc2UsdcPowershellConverterAdapter.__init__` / `adapter_from_env` / `preflight`
- [x] 2.2 `__init__` 移除 cwd fallback，未取得 storage_root 即 raise；`preflight()` 補 `STORAGE_ROOT` 檢查；`adapter_from_env` 顯式讀並傳 `storage_root`
- [x] 2.3 `bim-streaming-server/scripts/start-host-native-conversion-service.ps1` 補設 `STORAGE_ROOT=<repo_root>/storage`
- [x] 2.4 測試：未設 `STORAGE_ROOT` → 建構 / preflight raise；設了 → sandbox = 該 root

## 3. #4 誠實 health

- [x] 3.1 apply 前 `gitnexus_impact` on `health` / `HeadlessConverterNotConfigured`
- [x] 3.2 `HeadlessConverterNotConfigured` 加 `preflight()`；`health()` 呼叫 `store.converter.preflight()` 動態設 `status` / `ifc_to_usdc_conversion` / `reason`
- [x] 3.3 測試：converter 就緒 → ok；converter=None / preflight raise → degraded + reason 且不 500

## 4. #10 placeholder 全檔掃描

- [x] 4.1 apply 前 `gitnexus_impact` on `_assert_publishable_outputs` / `Ifc2UsdcPowershellConverterAdapter.convert`
- [x] 4.2 `_PLACEHOLDER_MARKERS` 下放 `conversion_authority` 作單一 source；store 與 adapter 都改全檔掃描並引用同一常數
- [x] 4.3 測試：placeholder 標記寫在 >4096 offset → 仍 raise `placeholder_usdc`；合法 USDC 通過

## 5. #11 HOOPS 失敗診斷結構化

- [x] 5.1 apply 前 `gitnexus_impact` on `_run_powershell_conversion`
- [x] 5.2 `convert-ifc-to-usdc.ps1` 在 throw 與 success emit 點加 `##CONV_META##` 單行 JSON；`_run_powershell_conversion` 改 sentinel JSON 抽取 + fallback 空 metadata
- [x] 5.3 測試：sentinel JSON 抽出含 Windows path；無 sentinel / 損壞 JSON → metadata 空但不 raise 非預期

## 6. #3 scoped traversal-safe /artifacts

- [x] 6.1 apply 前 `gitnexus_impact` on `build_app`
- [x] 6.2 移除 `StaticFiles` mount 與 `try/except`，改 `GET /artifacts/{job_id}/{filename}` + `relative_to` 防穿越 + `FileResponse`
- [x] 6.3 測試：合法取檔 200；`../` 穿越 404；不存在 job/filename 404

## 7. Verify + PR

- [x] 7.1 四層驗證（L1-L4），與 apply 前 baseline 比對
- [x] 7.2 `gitnexus_detect_changes` 確認 scope 不超預期；`git diff --cached --check`
- [x] 7.3 commit → push → 開 implementation PR（繁中標題 / 說明）
