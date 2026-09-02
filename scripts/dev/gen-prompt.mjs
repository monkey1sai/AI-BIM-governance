#!/usr/bin/env node
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log('======================================================');
  console.log('  AI-BIM-governance — 任務 Prompt 生成器 (Anti-Shortcut)');
  console.log('======================================================\n');

  console.log('請選擇目標服務:');
  console.log('  1. bim-review-coordinator (:8004) [Session / Proxy]');
  console.log('  2. governance-service (:49102)     [A1/A2/A3/BCF Authority]');
  console.log('  3. web-viewer-sample (:5173)       [Browser Client]');
  console.log('  4. bim-streaming-server            [IFC->USDC + Kit WebRTC]');
  console.log('  5. kit-manager (web/api :8010)     [Fleet Operator]');
  const svcChoice = await rl.question('\n請輸入編號 (預設 2): ');

  console.log('\n請選擇治理等級:');
  console.log('  F. Lane F (Fast Fix: 1~3 檔案微調/小修)');
  console.log('  B. Lane B (Bounded Change: 單一服務明確功能) [推薦]');
  console.log('  G. Lane G (Governed Change: 跨服務/架構/WebRTC/API變更)');
  const laneChoice = (await rl.question('請選擇 Lane (F/B/G，預設 B): ')).toUpperCase() || 'B';

  const taskDesc = await rl.question('\n請輸入任務需求描述 (一句話或重點): ');
  rl.close();

  const services = {
    '1': {
      name: 'bim-review-coordinator (:8004)',
      test: 'npm test',
      rule: '負責 Session/Control Plane 與外部 intake。修改前請確認外部合約 tests/contracts/。',
      symbolHint: 'SessionCoordinator'
    },
    '2': {
      name: 'governance-service (:49102)',
      test: '.venv\\Scripts\\python.exe -m pytest tests/',
      rule: 'A1/A2/A3 核心治理權威。必須嚴格使用 uv 虛擬環境，禁止全域 pip。',
      symbolHint: 'RuleEngine'
    },
    '3': {
      name: 'web-viewer-sample (:5173)',
      test: 'npm test / npx playwright test',
      rule: '一律只呼叫 coordinator :8004，嚴守 R2 API 三態（supported/unsupported/planned），禁改後端 proxy 與 app.py。',
      symbolHint: 'ViewerApp'
    },
    '4': {
      name: 'bim-streaming-server',
      test: '.venv\\Scripts\\python.exe -m pytest',
      rule: 'IFC->USDC 轉檔權威與 Kit WebRTC。嚴禁修改 conversion_authority.py。',
      symbolHint: 'ConversionAuthority'
    },
    '5': {
      name: 'kit-manager (apps/kit-manager-web & services/kit-manager-api)',
      test: 'npm test',
      rule: 'Kit fleet 遙測與管理介面，前後端契約一致性。',
      symbolHint: 'KitManagerService'
    }
  };

  const s = services[svcChoice] || services['2'];
  const lane = ['F', 'B', 'G'].includes(laneChoice) ? laneChoice : 'B';

  const promptOutput = `
[任務分級]: Lane ${lane}
[目標服務]: ${s.name}

### 一、 需求目標
${taskDesc || '實作並修復指定功能'}

### 二、 防偷懶硬約束 (Anti-Shortcut Rules)
1. 零佔位符：嚴禁使用 // TODO、// FIXME 或省略邏輯，所有異常與邊界條件必須完整實作。
2. 邊界鐵律：${s.rule}
3. 定義優先：修改前必須使用 view_file 或 GitNexus 檢視真實型別定義，嚴禁臆造 API 欄位。

### 三、 執行步驟
1. 執行影響分析：gitnexus impact <核心Symbol> -d upstream -r AI-BIM-governance
2. 實作最小有效改動。
3. 執行驗證指令：${s.test}
4. 範圍檢查：gitnexus detect-changes --scope compare --base-ref main

### 四、 完成標準與驗收證據
- 必須提供終端機測試 PASS 完整 Log 作為客觀證據。
- 說明已涵蓋的邊界條件 (Edge Cases)。
`;

  console.log('\n================== [ 產出的標準化 Prompt (可直接複製) ] ==================');
  console.log(promptOutput.trim());
  console.log('===========================================================================\n');
}

main().catch(console.error);