"""並發紀律守門（2026-07-10 修復輪）。

原 F4 finding 指 db.py `_conn` 未設 busy_timeout（與 issues/store.py 的顯式
`PRAGMA busy_timeout=5000` 不對稱）——實測**誤報**：Python `sqlite3.connect()`
預設 `timeout=5.0` 秒，等價 busy_timeout=5000ms，兩個 store 對同一顆
governance.db 的等鎖行為本已對稱。本測試把這個「隱性預設」鎖成顯性保證：
若未來有人改用 `sqlite3.connect(path, timeout=0)` 或降低等待，會在此紅燈。
"""
from db import Store


def test_conn_busy_timeout_matches_issue_store(tmp_path):
    store = Store(str(tmp_path / "governance.db"))
    conn = store._conn()
    try:
        # 與 issues/store.py 的顯式 PRAGMA busy_timeout=5000 同值（Python connect 預設 timeout=5.0）。
        assert conn.execute("PRAGMA busy_timeout").fetchone()[0] == 5000
    finally:
        conn.close()
