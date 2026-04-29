## 安全性說明

NVIDIA 重視其軟體、服務與原始碼倉庫的安全性。若你在使用本 repo 或相關 Omniverse / Kit 元件時發現疑似安全漏洞，請不要透過 GitHub / GitLab issue 直接公開回報。

## 如何回報 NVIDIA 產品安全漏洞

若你要回報任何 NVIDIA 產品的潛在安全漏洞，請使用以下正式管道：

- Web 表單：
  [Security Vulnerability Submission Form](https://www.nvidia.com/object/submit-security-vulnerability.html)
- Email：
  `psirt@nvidia.com`

建議使用 NVIDIA 提供的公開 PGP key 進行加密郵件溝通：

- [NVIDIA public PGP Key for communication](https://www.nvidia.com/en-us/security/pgp-key)

## 回報時建議附上的資訊

請盡量提供以下內容，以便 NVIDIA PSIRT 快速判斷與重現：

- 受影響的產品 / driver 名稱
- 版本號或 branch
- 漏洞類型
  - 例如：任意程式碼執行、DoS、buffer overflow 等
- 重現步驟
- PoC 或 exploit code（若有）
- 可能影響範圍
  - 例如攻擊者可如何利用
  - 影響的是本機、遠端還是多租戶環境

## 協調揭露

根據 NVIDIA 公開政策：

- 目前沒有公開 bug bounty 計畫
- 但若外部回報的安全問題依協調揭露流程被處理，NVIDIA 可能提供致謝

更多資訊請見：

- [NVIDIA Product Security Incident Response Team (PSIRT) Policies](https://www.nvidia.com/en-us/security/psirt-policies/)

## 官方安全入口

若你需要查看 NVIDIA 的安全公告、政策與其他安全資訊，請使用：

- https://www.nvidia.com/en-us/security

## Repo 使用建議

若你的問題屬於以下類型，請優先走安全通報流程，不要公開貼在 issue：

- 未授權存取
- 遠端執行
- 任意檔案讀寫
- 權限提升
- 憑證、token、session 洩漏
- WebRTC / signaling / streaming 元件中的可被外部利用缺陷

若只是一般功能 bug、build 失敗、相依衝突、或使用方式問題，則可依專案一般維護流程處理，不必走安全事件通報。
