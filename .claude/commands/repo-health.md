---
description: 對 AI-BIM-governance 跑四面向 repo 健檢（版本漂移 / 清理 / .claude 資產 / 文件同步），報告後經確認才修
argument-hint: "（選填）只看某面向：version / cleanup / assets / docs"
---

Invoke the `repo-health` skill.

對本 repo 跑唯讀四面向健檢，套用 `repo-health` output-style 畫出健康狀態表，結尾問使用者「要修哪幾項?」。**只修使用者確認的項目**，並遵守 skill 的安全鐵則（掃描唯讀、risky 項必確認、優先複用既有腳本、修完重驗）。

若帶了參數（version / cleanup / assets / docs），仍跑全掃但報告聚焦該面向。
