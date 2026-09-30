"""P5 reproducible synthetic size sweep (three sizes per geometry, plus combined caps)."""
from __future__ import annotations

import argparse
import json
from dataclasses import replace
from pathlib import Path

from make_presentation_probe_stage import ProbeSpec, build_probe_stage


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, type=Path)
    args = parser.parse_args()
    isolated = ProbeSpec(plane=False, surface_pressure=False)
    cases = {"base": isolated}
    for n, points in ((120, 80), (240, 120), (240, 200)):
        cases[f"stream_{n}x{points}"] = replace(isolated, streamlines=n, streamline_points=points)
    for n in (12, 24, 48):
        cases[f"growth_{n}"] = replace(isolated, streamlines=240, streamline_points=200,
            static_streamlines=False, growth="segments", growth_segments=n)
    for n in (1500, 3000, 6000):
        cases[f"particles_{n}"] = replace(isolated, streamlines=240, streamline_points=200,
            static_streamlines=False, particles=n)
    for n in (1000, 5000, 10000):
        cases[f"arrows_{n}"] = replace(isolated, arrows=n)
    for n in (1, 5, 13):
        cases[f"sections_{n}"] = replace(isolated, sections=n, section_spacing_m=2.0)
    cases["combined_caps"] = ProbeSpec(streamlines=240, streamline_points=200,
        growth="segments", growth_segments=48, particles=3000, arrows=5000, sections=13)
    entries = []
    for label, spec in cases.items():
        manifest = build_probe_stage(args.out_dir / label, spec)
        entry = {"label":label,"overlay_bytes":manifest["overlay_bytes"],"spec":manifest["spec"],"prims":manifest["prims"]}
        entries.append(entry)
        print(json.dumps({"label":label,"overlay_bytes":manifest["overlay_bytes"]}), flush=True)
    (args.out_dir / "sweep.json").write_text(json.dumps(entries,indent=2)+"\n",encoding="utf-8")


if __name__ == "__main__":
    main()
