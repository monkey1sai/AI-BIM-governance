# Tasks

## 1. A2-001：第二級 Tag 對齊型別護欄

- [x] 1.1 `engine.py` 第二級 `_tagmap` 鍵改為複合鍵 `(entity.is_a(), tag)`，配對迴圈改用複合鍵
- [x] 1.2 確認跨型別共用 Tag → removed + added（不誤配成 1 配對 0 變更）

## 2. A2-003：第三級同鍵簇穩定配對

- [x] 2.1 `engine.py` 第三級同鍵簇配對前，base / target 兩側以穩定次鍵（GlobalId，缺則 entity id）排序再 `zip`
- [x] 2.2 確認相同輸入重複執行配對與計數可重現

## 3. A2-002：退階對齊路徑測試

- [x] 3.1 `tests/test_diff_engine.py` 新增 helper `_element`（任意型別 + Tag + Status）
- [x] 3.2 測試 (a)：同型別同 Tag、不同 GUID → 以 tag 對齊（evidence.match == "tag"）
- [x] 3.3 測試 (b)：GUID 與 Tag 皆異、type+Name+loc 同 → 以 type_name_loc 對齊
- [x] 3.4 測試 (c)：跨型別同 Tag → removed + added（A2-001 不誤配）
- [x] 3.5 測試：同鍵多構件穩定配對（A2-003，重跑計數一致）

## 4. 誠實文件清理

- [x] 4.1 `engine.py` / `models.py` / `keys.py` 將與已落地 opt-in geometry_changed 矛盾的「p1 / 不計算 / 未實作」註解改述為「opt-in（預設關閉，需顯式啟用）已實作」
- [x] 4.2 保留仍正確的誠實標示（issue-impact 啟發式、3D overlay p15、無 representation 安全略過）

## 5. 自驗

- [x] 5.1 pytest 全綠（governance-service/tests，新增測試後增加）
- [x] 5.2 `npx openspec validate a2-diff-tag-typeguard --strict` 通過
- [x] 5.3 `git add -A && git diff --cached --check`（無 trailing whitespace）
