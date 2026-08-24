# Host-native job boundary bootstrap

- `stack_kind`: `self_referential_bootstrap`
- PR: `#573`
- trusted base: `89dd01c`（origin/main）
- ledger entry: `host-native-job-boundary`
- verification contract: `host-native-job-boundary/v1`

## Why bootstrap evidence is required

本 PR 落地 issue #522 的 launch-time OS containment boundary：`Start-HostNativeService` 改為 Windows named kill-on-close Job Object（assign→anchor into child→close own handle；deploy session 退出不殺服務、root 死全樹回收、顯式 stop 以 membership 為權威）；`Stop-HostNativeService` 改 job-first、PPID sweep 降為誠實 fallback；CAD hardener 與 Kit Manager import probe 兩個 bounded child 收斂進 `Invoke-HostNativeBoundedProcess`（匿名 kill-on-close job；POSIX 維持 sweep＋fail-closed 揭露，cgroup 依 #517）。

Canonical deployment transport 只消費 freshly fetched `origin/main`（#467 lineage），本分支無法在 merge 前以 canonical 路徑驗證變更後的 launcher／stop path／boundary。本檔記錄 pre-merge bounded evidence；merge 後必須自 main 重放凍結契約，**並由 owner 以 owner-approved inventory 執行 `canonical-linux-rebuild` 與 `canonical-linux-deployment-verify`**，再以 ledger-only fixpoint PR 關帳。

## Intended invariant

- Windows：每個 host-native 服務啟動時被指派進 named kill-on-close Job Object，job membership＝權威 descendant 集合；anchor handle 使 job 生命週期綁定服務樹本身。
- Bounded child（hardener／import probe）在 runner 持有的匿名 job 內執行；timeout → TerminateJobObject＋membership 空集合證明；正常結束 → 關 handle 回收 straggler。
- `Stop-HostNativeProcessTreeAndWait` 明文降為非邊界行程的 fallback；其 fail-closed 語意不變。
- POSIX：行為不變（setsid＋linger＋sweep 揭露）；`Test-HostNativeJobBoundarySupported` 誠實回報 unsupported。
- Breakaway 未開啟（不設任何 BREAKAWAY limit flag），descendant 無法逃逸。

已揭露殘留：Start-Process 後、AssignProcessToJobObject 前存在微小視窗，該視窗內 spawn 的子代不在 job 內（消除需 CREATE_SUSPENDED 啟動，不在本輪範圍）；assignment 之後產生的所有子代皆繼承 membership。

No credential, private topology, production metadata, or external runtime identifier is recorded.
