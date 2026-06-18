#!/usr/bin/env python
"""routing.json -> 各 std-*.js 的 // <routing:gen> const ROUTING 區塊 codegen。
只能 pre-session 跑；禁止 workflow run 中途執行。"""
import json, re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
RJSON = ROOT / ".claude/workflows/routing.json"
WF = ROOT / ".claude/workflows"
TARGETS = ["std-plan.js", "std-implement.js", "std-evidence.js"]
BEGIN, END = "// <routing:gen>", "// </routing:gen>"
_MARK = re.compile(re.escape(BEGIN) + r".*?" + re.escape(END), re.DOTALL)

def validate(data):
    allowed = data["allowed_efforts"]
    for name, t in data["tiers"].items():
        m, e = t["model"], t.get("effort")
        if m not in allowed:
            raise ValueError(f"tier {name}: unknown model {m}")
        if e not in allowed[m]:
            raise ValueError(f"tier {name}: effort {e!r} not allowed for {m} ({allowed[m]})")

def load_routing():
    data = json.loads(RJSON.read_text(encoding="utf-8"))
    validate(data)
    return data

def _entry(model, effort):
    parts = [f"model: '{model}'"]
    if effort is not None:
        parts.append(f"effort: '{effort}'")
    return "{ " + ", ".join(parts) + " }"

def render_block(data):
    tiers = data["tiers"]
    flags = data.get("flags", {})
    plan = tiers["reason"] if flags.get("plan_author_xhigh") else {"model": "opus", "effort": "max"}
    lines = [BEGIN, "const ROUTING = {"]
    for key in ("extract", "standard", "reason", "judge"):
        if key in tiers:
            lines.append(f"  {key}: {_entry(tiers[key]['model'], tiers[key].get('effort'))},")
    lines.append(f"  planAuthor: {_entry(plan['model'], plan.get('effort'))},")
    lines.append("}")
    lines.append(END)
    return "\n".join(lines)

def apply_to_text(text, block):
    if not _MARK.search(text):
        raise ValueError("marker region // <routing:gen> not found")
    return _MARK.sub(lambda m: block, text)

def main():
    check = "--check" in sys.argv
    data = load_routing()
    block = render_block(data)
    drift = []
    for fn in TARGETS:
        p = WF / fn
        text = p.read_text(encoding="utf-8")
        if BEGIN not in text:
            # 增量 wiring：尚未加 marker 的 target 先跳過
            print(f"SKIP (no routing:gen marker yet): {fn}")
            continue
        new = apply_to_text(text, block)
        if new != text:
            if check:
                drift.append(fn)
            else:
                p.write_text(new, encoding="utf-8")
                print(f"regenerated {fn}")
    if check and drift:
        print("DRIFT:", drift)
        sys.exit(1)
    sys.exit(0)

if __name__ == "__main__":
    main()
