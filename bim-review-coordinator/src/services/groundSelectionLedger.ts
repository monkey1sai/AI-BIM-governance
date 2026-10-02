import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { groundSelectionId, groundVersion } from "../contract/schemas/groundSurfaces.js";
import type { z } from "zod/v4";

type Version = z.infer<typeof groundVersion>;
/** User confirmation authority, committed synchronously after fresh runtime checks.
 * Geometry remains owned and revalidated by streaming. No mutable named head.
 */
export class GroundSelectionLedger {
  constructor(private readonly root: string) {}
  get(id: string): Version | null {
    groundSelectionId.parse(id);
    const file = path.join(this.root, `${id}.json`);
    if (!fs.existsSync(file)) return null;
    if (fs.statSync(file).size > 512 * 1024) throw new Error("ground_version_integrity_violation");
    const result = groundVersion.parse(JSON.parse(fs.readFileSync(file, "utf8")));
    if (result.selection_id !== id) throw new Error("ground_version_integrity_violation");
    return result;
  }
  save(version: Version): Version {
    const existing = this.get(version.selection_id);
    if (existing) return existing;
    const checked = groundVersion.parse(version);
    fs.mkdirSync(this.root, { recursive: true });
    const file = path.join(this.root, `${checked.selection_id}.json`), temporary = `${file}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(checked), { flag: "wx" });
    fs.renameSync(temporary, file);
    return checked;
  }
}
