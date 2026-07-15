---
name: frontend-design
description: 本 repo 採用的前端設計準則。建立或重構 web 元件 / 頁面 / 控制台 / overlay 時套用 —— 設計 token（OKLCH 色彩、字級、間距、圓角、陰影）、元件狀態鐵律（default/hover/focus-visible/active/disabled + loading/empty/error）、無障礙（WCAG 2.2 AA）、動效節制、以及 primary(主持)/spectator(旁觀) 協作介面與唯讀降級的誠實標示。當要設計或重構 AI-BIM-governance 前端（viewer / console / GovernanceOverlay）時使用。
metadata:
  type: reference
  origin: 收集自 Anthropic / Claude Code 官方前端設計來源（multi-agent research, 2026-06-05）
---

## 來源與驗證（誠實標示）

- 本檔由 multi-agent 研究 workflow 收集 Anthropic / Claude Code 官方前端設計來源後彙整（zh-TW 原創整理），於 2026-06-05 落地。
- **已驗證**：官方 `frontend-design` skill 確實存在於 `anthropics/skills`（WebFetch 確認 frontmatter 與內容）。其 frontmatter description 原文為：「Create distinctive, production-grade frontend interfaces with high design quality… Generates creative, polished code and UI design that avoids generic AI aesthetics.」該 skill 帶 `LICENSE.txt`，故本檔**不照抄其全文**，僅引用要點並連結原始來源。
- **未逐一複驗**：本檔其餘引用來源（design.md、claude-cookbooks、accessibility-agents、Anthropic 部落格等）由研究 agent 收集並標註，尚未由本 repo 維護者逐條人工複驗；採用前如需作為正式合規依據，請點開 §核心參考資源 的連結自行確認。
- 與本 repo 落地的關係：production 2D design authority 是唯讀 `C:\Repos\design\desigin-system` 與 `docs/plans/design-system-reference.manifest.json` 的 approved snapshot；`--ec-*` 是依 `primitive → semantic → component` 三層生成的 production projection，不是獨立上游真相。本準則只補充 a11y／工程品質；若與 pinned design reference 衝突，須在不降低 WCAG/security 的前提下走明確 rebaseline，不得自行建立第二套 token。

---

## Anthropic / Claude Code 官方前端設計系統規範

基於 Anthropic 官方資源的完整設計指南。所有指南均來自官方 Skills、文檔及產品公告。

---

### 1. 設計 Token 系統

#### 1.1 色彩系統（Color System）

**來源：** [Claude Design Announcement](https://www.anthropic.com/news/claude-design-anthropic-labs) | [DESIGN.md Specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)

- **色彩空間**：OKLCH（P3 wide gamut），提升色彩精度與跨裝置一致性
- **色盤架構**：
  - **主色（Primary）**：品牌核心顏色，用於關鍵互動元素
  - **次色（Secondary）**：補充色，強調次要操作
  - **中立色（Neutral）**：背景、文字、邊框用色階（通常 10-12 級）
  - **語意色（Semantic Colors）**：
    - Success（綠色）：確認、成功狀態
    - Error/Danger（紅色）：錯誤、危險操作
    - Warning（黃/橙）：警告、注意提示
    - Info（藍色）：資訊、中立提示

**設計原則**：
- 「**主色+銳利強調色**優於 timid、均勻分佈的色盤」 [Frontend Design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
- 禁用**老套配色**（特別是紫色漸層+白底） —— 這是「AI slop」標誌特徵
- 使用 CSS 變數確保一致性：`var(--color-primary)`, `var(--color-neutral-50)` 等

**CSS 實現範例**：
```css
:root {
  --color-primary: oklch(65% 0.2 20);
  --color-error: oklch(58% 0.24 25);
  --color-neutral-950: oklch(20% 0 0);
  --color-neutral-50: oklch(98% 0 0);
}
```

#### 1.2 字級階梯（Typography Scale）

**來源：** [Frontend Aesthetics Cookbook](https://raw.githubusercontent.com/anthropics/claude-cookbooks/refs/heads/main/coding/prompting_for_frontend_aesthetics.ipynb) | [DESIGN.md Typography](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)

**禁用字體**（AI slop 特徵）：
- ❌ Inter, Roboto, Arial, Space Grotesk（過度使用）
- ❌ System fonts（無個性）

**推薦字體策略**：

| 風格 | Display 字體 | Body 字體 | 用途 |
|------|-----------|---------|------|
| Code/Technical | JetBrains Mono, Fira Code | IBM Plex Mono | 開發者導向介面 |
| Editorial/Magazine | Playfair Display, Crimson Pro | Fraunces | 媒體、內容應用 |
| Startup/Modern | Clash Display, Satoshi | Cabinet Grotesk | SaaS 產品 |
| Luxury/Refined | Cormorant, Bodoni | Lora | 高端應用 |
| Playful | Obviously, Newsreader | (paired sans) | 教育、創意應用 |

**字級配對原則**：
- 相反對比（`high contrast pairings`）：Display+Mono、Serif+Geometric Sans
- 極端字重變化：100/200 vs 800/900（避免 400/600 的平庸組合）
- 推薦 9-15 級字級階梯（DESIGN.md spec）

**DESIGN.md Typography Token 結構**：
```yaml
typography:
  displayXL:
    fontFamily: Playfair Display
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.5px

  bodyBase:
    fontFamily: "Lora, serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0
```

#### 1.3 間距尺度（Spacing Scale）

**來源：** [DESIGN.md Specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) | [Awesome Claude Design](https://github.com/VoltAgent/awesome-claude-design)

**基礎單位**：4px grid
- 倍數體系：4, 8, 12, 16, 24, 32, 48, 64px

**密度（Density）策略**：
- **Spacious（寬鬆）**：用於高端、luxury 美感
- **Compact（緊密）**：用於資料密集介面
- **Balanced（均衡）**：大多數應用預設

**實裝 CSS 變數**：
```css
:root {
  --space-0: 0;
  --space-1: 4px;      /* xs */
  --space-2: 8px;      /* sm */
  --space-3: 12px;     /* md */
  --space-4: 16px;     /* lg */
  --space-6: 24px;     /* xl */
  --space-8: 32px;     /* 2xl */
}
```

#### 1.4 圓角（Rounded Corners）

**來源：** [DESIGN.md Specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md)

**圓角階梯**（依美感決定）：
- **Brutalist/Raw**：0px（無圓角）
- **Modern/Minimal**：4px-8px
- **Soft/Playful**：12px-16px
- **Organic**：50%（完全圓形）

**實裝**：
```css
:root {
  --radius-none: 0;
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 50%;
}

/* 應用範例 */
.button { border-radius: var(--radius-md); }
.card { border-radius: var(--radius-lg); }
```

#### 1.5 陰影與深度（Shadows & Elevation）

**來源：** [Frontend Design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)

**原則**：「創造**大氣與深度**，而非實心顏色」

**陰影配置**（OKLCH space）：
```css
:root {
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 6px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px rgba(0, 0, 0, 0.15);
}

/* 強調視覺深度 */
.elevated-card {
  box-shadow: var(--shadow-md);
  background: linear-gradient(135deg, rgba(255,255,255,0.1), transparent);
}
```

**視覺細節層次**：
- Gradient meshes、noise textures、geometric patterns
- Layered transparencies、dramatic shadows
- Decorative borders、custom cursors、grain overlays

---

### 2. 版面與資訊架構

#### 2.1 Layout Grid

**來源：** [DESIGN.md Specification](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) | [Frontend Design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)

**Grid 模型**（DESIGN.md 必須項）：
- 定義 column 數（12-col 常見）
- gutter 寬度（通常 16px-24px）
- max-content-width

**不對稱與打破預測**：
```css
/* 推薦：打破規律的佈局 */
.asymmetric-layout {
  display: grid;
  grid-template-columns: 1fr 1.5fr 1fr;  /* 不均等 */
  gap: var(--space-6);
}

/* 避免：預測性、cookie-cutter 的 equal columns */
```

**原則**：
- ✅ 非對稱、重疊、對角線流動
- ✅ 打破 grid 元素、慷慨負空間
- ✅ 或受控密度的最大化方向
- ❌ 可預測的版面模式

#### 2.2 導航模式（Navigation Patterns）

**來源：** [Claude Projects](https://www.anthropic.com/news/projects) | [Harness Design](https://www.anthropic.com/engineering/harness-design-long-running-apps)

**層級導航**：
- **Primary Navigation**：主要功能類別（sidebar, top nav）
- **Secondary Navigation**：上下文相關的子項
- **Tertiary Navigation**：頁內快速連結（breadcrumbs, in-page links）

**協作導航原則**（基於 Claude Projects）：
- 清晰的**編輯 vs 檢視模式指示**
- 權限層級視覺化：private / shared-view / shared-edit
- 狀態回饋：「誰在編輯」、「同步狀態」

#### 2.3 面板、抽屜、覆蓋層使用時機

**來源：** [Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs)

| 元件 | 使用時機 | 特性 |
|------|--------|------|
| **Modal** | 操作必須阻斷背景流 | 遮罩背景、focus trap、必須確認 |
| **Drawer/Sidebar** | 非阻斷的側邊工具 | 可點擊背景關閉、保留主要內容可見 |
| **Toast/Snackbar** | 無阻斷的短期提示 | 自動消失、堆疊、可關閉 |
| **Popover/Tooltip** | 內文相關提示 | 浮動、anchor 到元素、hover 觸發 |

**原則**：
- 避免多層 modal 堆疊
- Drawer 用於導航，Modal 用於關鍵決策
- Toast 用於非關鍵通知

---

### 3. 元件狀態鐵律（Component State Management）

**來源：** [DESIGN.md Components](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) | [Accessibility Guidelines](https://github.com/Community-Access/accessibility-agents/blob/main/CLAUDE.md) | [Frontend Design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)

#### 3.1 互動狀態（Interactive States）

所有互動元素必須實裝以下狀態：

| 狀態 | 定義 | 視覺表現 | 用途 |
|------|------|--------|------|
| **Default** | 未操作狀態 | 基礎樣式 | 靜態呈現 |
| **Hover** | 滑鼠停留 | 背景色/陰影變化 | 桌面反饋 |
| **Focus** | 鍵盤/焦點進入 | Focus ring（3-4px） | 鍵盤無障礙導航 |
| **Focus-Visible** | 鍵盤焦點（非滑鼠） | 明顯 outline（4px, 2px offset） | WCAG 2.4.11 compliance |
| **Active/Pressed** | 被按下/選中 | 反向色、縮小、深色 | 正在互動的視覺確認 |
| **Disabled** | 不可操作 | 50% opacity、無游標改變、無 hover 效果 | 清晰傳達不可用 |

**CSS 實裝模式**：
```css
.button {
  background: var(--color-primary);
  transition: all 200ms ease;
  cursor: pointer;
}

.button:hover:not(:disabled) {
  background: oklch(from var(--color-primary) calc(l + 5%) c h);
  box-shadow: var(--shadow-md);
}

.button:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

.button:active:not(:disabled) {
  transform: scale(0.98);
  box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
}

.button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background: var(--color-neutral-200);
}
```

#### 3.2 內容狀態（Content States）

所有動態內容容器必須顯式處理：

| 狀態 | 定義 | 視覺表現 | 例子 |
|------|------|--------|------|
| **Loading** | 資料載入中 | Skeleton screens 或 spinner | 資料表格初始化 |
| **Empty** | 無資料 | 空狀態插圖 + 呼籲操作 | 「沒有任務」頁面 |
| **Error** | 操作失敗 | 紅色警示 + 錯誤訊息 + retry 按鈕 | API 失敗、驗證錯誤 |
| **Success** | 操作完成 | 綠色勾選 + 確認訊息 | 表單提交成功 |
| **Skeleton** | 資料佔位符 | 灰色 pulse 動畫 | 清單項目預載 |

**DESIGN.md Component Variant 定義**：
```yaml
components:
  Button:
    default:
      backgroundColor: "{colors.primary}"
      textColor: white
      padding: 12px 16px
      rounded: "{rounded.md}"
      height: 36px

    variants:
      hover:
        backgroundColor: "{colors.primary-dark}"

      disabled:
        backgroundColor: "{colors.neutral-200}"
        opacity: 0.5

      loading:
        opacity: 0.7
        pointerEvents: none

  EmptyState:
    container:
      padding: 48px 24px
      textAlign: center
    icon:
      size: 64px
      color: "{colors.neutral-300}"
    message:
      typography: "{typography.bodyLarge}"
      color: "{colors.neutral-600}"
```

---

### 4. 無障礙設計（A11y - WCAG 2.2 AA）

**來源：** [Accessibility Agents](https://github.com/Community-Access/accessibility-agents) | [Claude Code Accessibility](https://github.com/affaan-m/everything-claude-code/blob/main/skills/accessibility/SKILL.md) | [Frontend Design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)

#### 4.1 Focus Ring 與鍵盤導航

**必須實裝**（WCAG 2.4.11 - Focus Visible）：
```css
/* 所有互動元素都需要可見焦點指示器 */
button, a, input, select, textarea {
  outline: 3px solid var(--color-focus);
  outline-offset: 2px;
}

/* 避免移除焦點樣式 */
*:focus { outline: none; } /* ❌ 禁止 */

/* 使用 :focus-visible 區分鍵盤 vs 滑鼠 */
button:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
}

button:focus:not(:focus-visible) {
  outline: none; /* 滑鼠點擊時無外框 */
}
```

**鍵盤導航順序**（Tab order）：
- 邏輯順序應符合視覺閱讀方向
- 使用 `tabindex` 時謹慎（盡量避免，依靠 DOM 順序）
- Skip link 用於長導航（例如跳過重複導航到主內容）

#### 4.2 ARIA 與 Semantic HTML

**優先級規則**：
1. ✅ Semantic HTML 優先（`<button>`, `<nav>`, `<main>`, `<article>` 等）
2. ✅ 僅當 native 語義不足時才加 ARIA
3. ❌ 避免 ARIA role 濫用或衝突

**常見模式**：

```html
<!-- ✅ 正確：使用 semantic elements -->
<button aria-pressed="false">Toggle</button>
<nav aria-label="Main navigation">...</nav>

<!-- ❌ 錯誤：過度 ARIA -->
<div role="button" tabindex="0">Click me</div>

<!-- ❌ 錯誤：ARIA 角色衝突 -->
<button role="link">Link Button</button> <!-- 冗餘 -->
```

#### 4.3 Disabled 狀態的無障礙處理

**禁止規則**（來自 A11y 指南）：
```css
/* ❌ 錯誤：pointer-events: none 隱藏可達性 */
button:disabled {
  pointer-events: none; /* 屏蔽螢幕閱讀器 */
}
```
```html
<!-- ✅ 正確：使用 HTML disabled attribute -->
<button disabled>Cannot use</button>

<!-- ✅ 或使用 aria-disabled（如需自訂樣式） -->
<button aria-disabled="true" role="button">Cannot use</button>
```

**原則**：
- 使用 HTML `disabled` 屬性（自動被螢幕閱讀器識別）
- 避免 `pointer-events: none`（隱藏障礙用戶的操作反饋）
- 若需回饋，使用 aria-disabled + role

#### 4.4 色彩對比（WCAG 2.4.11 - Color Contrast）

**最低標準**（WCAG AA）：
- **Normal text**：至少 4.5:1
- **Large text**（18px+ 或 14px+ 粗體）：3:1
- **UI components & borders**：3:1

**檢查方式**：
- WebAIM Color Contrast Checker
- axe DevTools
- Contrast Ratio: https://www.contrastchecker.com/

```css
/* ✅ 符合 WCAG AA */
.text {
  color: oklch(30% 0 0);        /* 深灰 */
  background: oklch(98% 0 0);   /* 淺灰 - contrast: 15:1 */
}

/* ❌ 不符合 */
.weak-text {
  color: oklch(50% 0 0);        /* 中灰 */
  background: oklch(95% 0 0);   /* 淺灰 - contrast: 2.8:1 */
}
```

#### 4.5 鍵盤操作完整性

**必須支援**：
- Tab / Shift+Tab：前進/後退焦點
- Enter / Space：啟動按鈕
- Arrow keys：下拉選單、標籤頁、menu items
- Escape：關閉 modal、popover

```js
// ✅ 完整鍵盤支援範例
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeModal();
  }
  if (e.key === 'ArrowDown') {
    focusNextMenuItem();
  }
});
```

---

### 5. 動效節制原則（Motion Principles）

**來源：** [Frontend Design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | [Motion Design Principles](https://github.com/kylezantos/design-motion-principles) | [Animate.css Skill](https://github.com/msrbuilds/animate-css-skill)

#### 5.1 動效哲學

**核心原則**：「一次精心編排的頁面載入，搭配階梯揭示，比零散的微互動更愉悅」

**層級**：
- ✅ **High-impact moments**：頁面載入、轉場、確認動作
- ✅ **Intentional micro-interactions**：hover 狀態、toggle、expand/collapse
- ❌ **Scattered animations**：每個元素都動，視覺混亂

#### 5.2 動效實裝原則

**推薦方案**：
- **HTML**：CSS-only 解決方案（無 JS 依賴）
- **React**：Motion library、Framer Motion、GSAP

**重點**：
```css
/* ✅ 高效動畫：僅 transform 和 opacity */
.card {
  animation: fadeInScale 600ms ease-out;
}

@keyframes fadeInScale {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* ❌ 低效動畫：影響 layout recalculation */
@keyframes bad-animation {
  from { width: 0; height: 0; }
  to { width: 100px; height: 100px; }
}

/* 改進版本 */
@keyframes good-animation {
  from { transform: scale(0); }
  to { transform: scale(1); }
}
```

#### 5.3 Staggered Reveals（階梯揭示）

```css
.list-item {
  animation: slideInUp 500ms ease-out backwards;
}

.list-item:nth-child(1) { animation-delay: 0ms; }
.list-item:nth-child(2) { animation-delay: 100ms; }
.list-item:nth-child(3) { animation-delay: 200ms; }

@keyframes slideInUp {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

#### 5.4 Reduced Motion 無障礙遵循

**必須實裝**（WCAG 2.3.3）：

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}

/* 或更細緻的控制 */
@media (prefers-reduced-motion: no-preference) {
  .animated-element {
    transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .animated-element {
    transition: none;
  }
}
```

#### 5.5 Timing & Easing

**推薦曲線**：
```css
/* 標準 easing */
--timing-standard: cubic-bezier(0.4, 0, 0.2, 1);  /* Material Design */
--timing-emphasis: cubic-bezier(0.2, 0, 0, 1);    /* 出現強調 */
--timing-gentle: cubic-bezier(0.4, 0.1, 0.4, 1);  /* 溫和退出 */

/* 應用 */
.fast-feedback { transition: all 150ms var(--timing-standard); }
.page-transition { transition: all 600ms var(--timing-emphasis); }
```

**持續時間指南**：
- **Micro-interactions**（button hover）：150-200ms
- **UI state changes**：300-400ms
- **Page transitions**：600-800ms
- **Background animations**：2000ms+

---

### 6. 協作介面設計原則（Collaborative UI）

**特別針對「即時 3D 協作 / 會議主持（Primary）與旁觀（Spectator）」**

**來源：** [Claude Design](https://www.anthropic.com/news/claude-design-anthropic-labs) | [Claude Projects](https://www.anthropic.com/news/projects) | [Harness Design](https://www.anthropic.com/engineering/harness-design-long-running-apps)

#### 6.1 權限可見性與層級標示

**必須清晰指示的層級**：

| 權限層級 | 視覺表現 | UI 控制 | 反饋 |
|---------|--------|--------|------|
| **Owner / Primary** | 無標記（預設） | 完整編輯、刪除、共享 | 所有變更立即生效 |
| **Editor** | 小標籤「Can Edit」 | 編輯內容、但無刪除/共享 | 變更可視、有確認 |
| **Viewer / Spectator** | 標籤「View Only」 | 檢視、評論、無編輯 | 禁用所有編輯控制 |
| **Blocked/Expired** | 灰出、錯誤狀態 | 無操作 | 清晰錯誤訊息 |

**實裝範例**：
```html
<!-- 權限指示器 -->
<div class="permission-badge">
  <span class="permission-level" data-level="viewer">View Only</span>
  <span class="permission-updated">Last updated 2 min ago</span>
</div>

<!-- 編輯工具條 - 根據權限條件渲染 -->
<div class="editing-toolbar" data-editable="false">
  <!-- ✅ 正確：disabled state，不是 hidden -->
  <button class="edit-btn" disabled aria-disabled="true">
    Edit (View Only)
  </button>
</div>
```

#### 6.2 唯讀降級的誠實標示

**原則**：「使用者應該**永遠知道**何時不能編輯」

**禁止做法**：
- ❌ 隱藏編輯按鈕（讓使用者困惑）
- ❌ 默默拒絕變更（無回饋）
- ❌ 欺騙性的 readonly input（看起來可編輯但不能）

**正確實裝**：
```html
<!-- ✅ 誠實標示：disabled + clear label -->
<input
  type="text"
  value="Cannot edit"
  disabled
  aria-disabled="true"
  title="You have view-only access to this document"
/>

<!-- ✅ 禁用按鈕 + 提示 -->
<button
  disabled
  aria-disabled="true"
  title="Upgrade to Editor role to make changes"
>
  Add Item
</button>

<!-- ✅ Toast 回饋 -->
<toast role="alert" aria-live="assertive">
  You don't have permission to edit this. Ask the owner for access.
</toast>
```

**CSS 視覺區分**：
```css
/* View-only mode 明確降級 */
.viewer-mode .editable-content {
  opacity: 0.7;
  border: 1px dashed var(--color-neutral-300);
}

.viewer-mode input:disabled,
.viewer-mode button:disabled {
  background: var(--color-neutral-50);
  color: var(--color-neutral-500);
  cursor: not-allowed;
}

/* 提示文字 */
.viewer-badge::after {
  content: "View Only";
  display: inline-block;
  padding: 4px 8px;
  background: var(--color-warning);
  color: white;
  border-radius: 4px;
  font-size: 12px;
  margin-left: 8px;
}
```

#### 6.3 狀態回饋與同步指示

**實即時協作必須回饋的信息**：

| 狀態 | 視覺指示 | 位置 | 優先級 |
|------|---------|------|--------|
| **編輯中** | 動畫 icon + 使用者名稱 | 工具列或 toast | 高 |
| **同步狀態** | 勾選/同步 icon | 右上角 | 中 |
| **衝突** | 紅色警告 + 解決方案提示 | Modal 或 toast | 最高 |
| **離線** | 離線 badge + 禁用編輯 | 頂部 banner | 高 |
| **自動儲存** | 靜默 + 時間戳 | Footer | 低 |

**實裝**：
```tsx
// React 協作組件範例
function CollaborationStatus({ permission, isSyncing, lastUser }) {
  return (
    <div className="collab-status">
      {permission === 'viewer' && (
        <span className="badge badge-view-only">View Only</span>
      )}

      {isSyncing && (
        <span className="badge badge-syncing" role="status">
          <Spinner size="sm" /> Syncing...
        </span>
      )}

      {lastUser && (
        <span className="badge badge-last-edit">
          Updated by {lastUser.name} 2min ago
        </span>
      )}
    </div>
  );
}
```

#### 6.4 主持人（Primary）vs 旁觀者（Spectator）的 UI 分層

**3D 協作應用特定指引**：

| 組件 | Primary 可見 | Spectator 可見 | 行為差異 |
|------|-----------|---------------|---------|
| **視點控制** | ✅ 完整 3D 操作 | ✅ 檢視（可旋轉） | Primary 變更 → Spectator 自動追蹤 |
| **編輯工具** | ✅ 全部 | ❌ 隱藏或 disabled | Spectator 嘗試編輯 → toast 提示 |
| **層級面板** | ✅ 可編輯 | ✅ 可檢視 | 雙向同步，Spectator 無選擇 |
| **歷史/復原** | ✅ 完整 | ✅ 唯讀紀錄 | 僅 Primary 可復原 |
| **共享設定** | ✅ 可編輯 | ❌ 隱藏 | 防止權限提升 |

**實裝**：
```jsx
function CollaborativeCanvas({ userRole }) {
  const isSpectator = userRole === 'spectator';
  const isPrimary = userRole === 'primary';

  return (
    <div className="canvas-container">
      {/* 工具列 - 根據角色渲染 */}
      <ToolBar>
        <ObjectTransformTool disabled={isSpectator} />
        <ColorPickerTool disabled={isSpectator} />
        {isPrimary && <ShareSettingsTool />}
      </ToolBar>

      {/* 3D 檢視 */}
      <Canvas3D
        allowInteraction={!isSpectator}
        onViewChange={handleViewChange}
      />

      {/* 狀態標示 */}
      {isSpectator && (
        <SpectatorBadge>
          Watching {primaryUser.name}'s edits
        </SpectatorBadge>
      )}
    </div>
  );
}
```

> 本 repo 對齊註記：上述 Spectator gating 在前端僅為 UX；真正的權限邊界在後端（streaming-server 驗 `source_client_id` + session 身份）。前端 `disabled` 與後端拒絕為**防禦縱深**的兩層，文件須明示「前端非授權邊界」。

#### 6.5 協作設計的無障礙須知

**額外要求**（基於 WCAG 2.2 + 協作特性）：

```html
<!-- ✅ Live region：實時宣告協作變更 -->
<div role="region" aria-live="polite" aria-label="Collaboration updates">
  <!-- 自動更新的內容 -->
  <p>John added a new layer "Background"</p>
</div>

<!-- ✅ 禁用狀態的清晰標示 -->
<button
  aria-disabled="true"
  title="You need Editor permission to edit objects"
>
  Edit Object
</button>

<!-- ✅ 對話窗權限提示 -->
<dialog aria-labelledby="dialog-title" role="alertdialog">
  <h2 id="dialog-title">Cannot Edit</h2>
  <p>You have view-only access. Request editor access?</p>
  <button onclick="requestAccess()">Request Access</button>
</dialog>
```

---

### 7. 完整設計系統模板（DESIGN.md Format）

**來源：** [google-labs-code/design.md](https://github.com/google-labs-code/design.md) | [Anthropic Cookbook](https://raw.githubusercontent.com/anthropics/claude-cookbooks/refs/heads/main/coding/prompting_for_frontend_aesthetics.ipynb)

**建議新項目開始的模板結構**：

```markdown
---
colors:
  primary: oklch(65% 0.2 20)
  primary-dark: oklch(58% 0.2 20)
  primary-light: oklch(72% 0.15 20)

  error: oklch(58% 0.24 25)
  success: oklch(62% 0.21 150)
  warning: oklch(75% 0.2 70)

  neutral-50: oklch(98% 0 0)
  neutral-100: oklch(96% 0 0)
  neutral-900: oklch(20% 0 0)
  neutral-950: oklch(10% 0 0)

typography:
  displayXL:
    fontFamily: "Clash Display, sans-serif"
    fontSize: 48px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.5px

  bodyBase:
    fontFamily: "Lora, serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0

spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px

rounded:
  none: 0
  sm: 4px
  md: 8px
  lg: 12px
  full: 50%

components:
  Button:
    primary:
      backgroundColor: "{colors.primary}"
      textColor: white
      padding: 12px 16px
      rounded: "{rounded.md}"
      height: 36px
      fontSize: 14px
      fontWeight: 600

    primary-hover:
      backgroundColor: "{colors.primary-dark}"
      boxShadow: "0 4px 12px rgba(0,0,0,0.15)"

    primary-disabled:
      backgroundColor: "{colors.neutral-200}"
      textColor: "{colors.neutral-500}"
      opacity: 0.5

  Card:
    default:
      backgroundColor: white
      padding: "{spacing.lg}"
      rounded: "{rounded.lg}"
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)"
      border: "1px solid {colors.neutral-200}"

---

# Overview

A modern, accessible design system emphasizing [your aesthetic: minimalist/maximalist/retro/luxury] design with clear hierarchy and inclusive patterns.

## Color Philosophy

Primary color {colors.primary} paired with neutral grays for maximum contrast. Semantic colors for error/warning/success feedback.

## Typography

Display font [Clash Display] for headlines creates immediate visual interest. Body text in Lora ensures readability for extended content.

## Motion

Animations focus on high-impact page load and state transitions (300-600ms). All animations respect prefers-reduced-motion.

## Accessibility

WCAG 2.2 AA compliance required. All interactive elements have visible :focus-visible states. Color contrast meets 4.5:1 for normal text.
```

---

### 8. 設計系統品質檢核清單

**來源：** [Frontend Design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | [Harness Design](https://www.anthropic.com/engineering/harness-design-long-running-apps)

在提交設計前確認：

#### 8.1 視覺設計檢核
- [ ] 選擇了**明確的美感方向**（不是混合風格）
- [ ] 字體選擇**特色鮮明**（不是 Inter/Roboto）
- [ ] 色盤使用**強勢主色+銳利強調**（不是均勻分佈）
- [ ] 避免**紫色漸層+白底**的老套組合
- [ ] 背景有**視覺深度**（漸層、紋理、圖案），非純色
- [ ] 版面有**非對稱、打破規律**的特色
- [ ] 每個元件都有**細節用心**（陰影、邊框、hover 效果）

#### 8.2 互動設計檢核
- [ ] 所有按鈕實裝了 `hover/focus/active/disabled` 四種狀態
- [ ] `focus-visible` outline 清晰可見（3-4px）
- [ ] 動畫集中在**高影響時刻**（頁面載入、轉場），不是散亂微互動
- [ ] 重視 `prefers-reduced-motion`
- [ ] 動畫時間 < 600ms（不拖累感知速度）

#### 8.3 無障礙檢核
- [ ] 所有文字對比 ≥ 4.5:1（WCAG AA）
- [ ] 鍵盤可完整操作（Tab、Enter、Escape、Arrow）
- [ ] 使用 Semantic HTML（`<button>`, `<nav>`, 不是 `<div role="button">`）
- [ ] ARIA 僅用於 semantic HTML 不足之處
- [ ] Disabled 狀態用 HTML `disabled` attribute，非 `pointer-events: none`
- [ ] 測試過屏幕閱讀器（NVDA、VoiceOver）

#### 8.4 協作介面檢核（如適用）
- [ ] 權限層級**視覺清晰可區分**
- [ ] View-only 模式有**誠實標示**（不隱藏編輯按鈕）
- [ ] 實時狀態有**明確回饋**（同步、編輯、衝突）
- [ ] Primary vs Spectator 角色的 UI **分層恰當**
- [ ] 所有禁用控制都有 `title` / `aria-label` 解釋理由

#### 8.5 程式碼品質檢核
- [ ] 使用 **CSS 變數**統一管理 token（顏色、spacing 等）
- [ ] 動畫優化：僅 `transform` 和 `opacity`（非 width/height）
- [ ] 避免 `!important`（除非特殊情況）
- [ ] 響應式設計使用 mobile-first 策略
- [ ] 已驗證跨瀏覽器相容性（Chrome, Firefox, Safari, Edge）

---

## 核心參考資源

| 資源 | URL | 重點 |
|------|-----|------|
| **Frontend Design Skill**（已驗證存在） | [anthropics/skills/frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | 完整的美感與實裝指引 |
| **Claude Design 公告** | [Anthropic Labs](https://www.anthropic.com/news/claude-design-anthropic-labs) | 設計系統自動化、協作功能 |
| **DESIGN.md 規範** | [google-labs-code/design.md](https://github.com/google-labs-code/design.md/blob/main/docs/spec.md) | 標準化設計 token 格式 |
| **Frontend Aesthetics Cookbook** | [anthropics/claude-cookbooks](https://raw.githubusercontent.com/anthropics/claude-cookbooks/refs/heads/main/coding/prompting_for_frontend_aesthetics.ipynb) | 字體、色彩、動效案例 |
| **Harness Design** | [Anthropic Engineering](https://www.anthropic.com/engineering/harness-design-long-running-apps) | 長期應用狀態管理、協作架構 |
| **Accessibility Agents** | [Community-Access/accessibility-agents](https://github.com/Community-Access/accessibility-agents) | WCAG 2.2 AA compliance agent |
| **Claude Projects** | [Anthropic News](https://www.anthropic.com/news/projects) | 團隊協作、權限管理 |

---

## 總結：Anthropic 設計哲學

**Anthropic 官方推薦的前端設計不是「安全的預設」，而是「大膽的視野 + 精細的執行」。**

> "Claude is capable of extraordinary creative work. Don't hold back—show what can truly be created when thinking outside the box and committing fully to a distinctive vision."
>
> —— [Frontend Design Skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)

### 三個原則

1. **有立場的美感**：選擇明確的美學方向（brutalist、luxury、playful 等），而不是折衷的灰色設計
2. **有意圖的細節**：每個元素（字體、顏色、間距、動畫）都應服務於整體美感，不是隨意拼湊
3. **真誠的無障礙**：包含無障礙是義務，而不是事後補救；視覺禁用狀態要誠實標示，不能欺騙使用者

---

**本研究文檔基於 Anthropic 官方 GitHub repositories、工程部落格及 Claude Design 產品文檔編製。除官方 `frontend-design` skill 已驗證外，其餘來源連結為研究階段收集、未逐一人工複驗；採用前請點開連結確認。**
