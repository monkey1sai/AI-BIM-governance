## ADDED Requirements

### Requirement: primary viewer SHALL 提供「模型 / 問題」分頁，問題分頁以全幅呈現 A1/A2/A3 治理操作且無 GPU 亦可用

primary 治理 viewer SHALL 提供分頁切換：「模型」分頁呈現語意檢視（3D/mock viewport + ①②③④⑥ 面板），「問題」分頁以**全幅**呈現既有 `GovernanceOverlay` 的 A1/A2/A3 治理操作（rule-run 觸發、失敗構件清單→3D 高亮、issue/BCF、Stage/Artifact Binding）。分頁列 SHALL 位於 viewer 層（非 MockViewport 內），使「問題」分頁隱藏 MockViewport 後仍可切回「模型」。「問題」分頁的治理操作 SHALL 在無 live 3D 幀（無 GPU/Kit）時仍可用（rule-run 經 coordinator for-session、issue/BCF 經 governance proxy）；其中需 DataChannel 的 3D 高亮 SHALL 誠實降級（disabled + 理由），SHALL NOT 假裝可用。spectator 三層唯讀權威 SHALL 於兩分頁皆保留。

#### Scenario: 模型↔問題 分頁切換，問題分頁全幅治理且無 GPU 可操作

- **WHEN** 真人於 primary viewer 點「問題」分頁
- **THEN** SHALL 隱藏語意檢視、以全幅呈現 A1/A2/A3 治理面板（rule-run 控制可見可操作），SHALL NOT 仍擠在固定 340px 右側窄欄
- **AND** 在無 live 3D 幀時 rule-run/issue/BCF SHALL 仍可用，需 DataChannel 的 3D 高亮 SHALL 誠實 disabled（不假裝可用）
- **AND** 點「模型」分頁 SHALL 切回語意檢視（3D/mock viewport + ①②③④⑥）；spectator SHALL 維持唯讀權威
- **AND** SHALL 具 browser E2E 證據（分頁切換 live 驗 + harness 不空白回歸）
