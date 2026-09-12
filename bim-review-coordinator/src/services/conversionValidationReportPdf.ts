import PDFDocument from "pdfkit";
import { openSync } from "fontkit";
import { fileURLToPath } from "node:url";
import { setImmediate as yieldTurn } from "node:timers/promises";
import type { ConversionValidationRecord } from "./conversionValidationRecord.js";

// Fixed application asset, never a user path or network URL. build copies assets into dist/.
const fontPath = fileURLToPath(new URL("../../assets/fonts/NotoSansCJKtc-Regular.otf", import.meta.url));
const MAX_INPUT_UNITS = 8_000_000;
const MAX_NODES = 200_000;
const MAX_PAGES = 600;
const MAX_BYTES = 16 * 1024 * 1024;
let rendering = false;
const unavailable = () => new Error("PDF report unavailable.");
const purposeNames = {
  view_3d: "3D 檢視", locate_highlight: "構件定位與高亮",
  distance_measurement: "距離量測", ifc_rules: "IFC 規則檢核",
};
const outcomeNames = {
  usable: "可使用", usable_with_limits: "有限制可使用",
  not_usable: "不可使用", not_validated: "尚未驗證",
};

/** Count incrementally BEFORE allocating JSON, document, glyph layout, or output buffers. */
function checkBudget(value: unknown): Set<number> {
  let nodes = 0, units = 0;
  const characters = new Set<number>();
  function visit(item: unknown, depth: number): void {
    if (++nodes > MAX_NODES || depth > 20) throw unavailable();
    if (typeof item === "string") {
      units += item.length;
      if (units > MAX_INPUT_UNITS) throw unavailable();
      // JSON escapes ASCII controls in the full appendix; summary normalizes whitespace.
      for (const char of item) if (char.codePointAt(0)! >= 32) characters.add(char.codePointAt(0)!);
    }
    else if (Array.isArray(item)) {
      if (item.length > MAX_NODES - nodes) throw unavailable();
      for (const child of item) visit(child, depth + 1);
    } else if (item !== null && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        units += key.length; visit(child, depth + 1);
      }
    }
    if (units > MAX_INPUT_UNITS) throw unavailable();
  }
  visit(value, 0);
  return characters;
}

function summaryText(value: string): string {
  const text = value.replace(/\s+/gu, " ");
  const characters = Array.from(text);
  return characters.length <= 60 ? text : characters.slice(0, 60).join("") + "…（摘要，全文見明細）";
}

/** Full scalar-path appendix, not a truncated summary. JSON attachment retains exact types. */
function* fields(value: unknown, prefix: string): Generator<string> {
  if (Array.isArray(value) && ["correspondence", "inventory.missing", "inventory.excluded"].includes(prefix)) {
    // One complete component per row keeps a real building readable without repeating
    // the same scalar-path prefix on every property. No GUID or prim path is truncated.
    for (let n = 0; n < value.length; n++) yield prefix + "[" + n + "]: " + JSON.stringify(value[n]);
    if (!value.length) yield prefix + ": []";
  } else if (Array.isArray(value) && value.length) {
    for (let n = 0; n < value.length; n++) yield* fields(value[n], prefix + "[" + n + "]");
  } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) yield* fields(child, prefix ? prefix + "." + key : key);
  } else {
    yield prefix + ": " + JSON.stringify(value);
  }
}

/** Already-authorized, already-projected DTO only. No policy evaluation or ledger writes. */
export async function serializeValidationReportPdf(dto: ConversionValidationRecord, signal?: AbortSignal): Promise<Buffer> {
  if (rendering) throw unavailable();
  rendering = true;
  let doc: PDFKit.PDFDocument | undefined;
  const deadline = Date.now() + 60_000;
  try {
    signal?.throwIfAborted();
    const characters = checkBudget(dto);
    const font = openSync(fontPath);
    if (!("hasGlyphForCodePoint" in font) || [...characters].some(code => !font.hasGlyphForCodePoint(code))) {
      throw unavailable();
    }
    doc = new PDFDocument({ size: "A4", margin: 48, autoFirstPage: false, bufferPages: false,
      info: { Title: "IFC → USDC 用途驗證報表", Author: "AI-BIM", CreationDate: new Date(dto.validatedAt) } });
    const current = doc, chunks: Buffer[] = [];
    let bytes = 0, pages = 0, failure: Error | undefined;
    const ended = new Promise<void>(resolve => {
      current.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) { failure = unavailable(); current.destroy(); }
        else chunks.push(chunk);
      });
      current.once("error", () => { failure = unavailable(); resolve(); });
      current.once("end", resolve);
      current.once("close", resolve);
    });
    current.on("pageAdded", () => {
      if (++pages > MAX_PAGES) throw unavailable();
    });
    current.registerFont("ReportCJK", fontPath);
    current.font("ReportCJK");
    current.addPage();
    const line = (text: string, size = 10) => {
      if (failure || current.destroyed || signal?.aborted || Date.now() > deadline) throw unavailable();
      current.fontSize(size).fillColor("#172d40").text(text, { lineGap: 3 });
    };
    line("IFC → USDC 用途驗證報表", 20);
    line(summaryText(dto.source.name), 15);
    line("模型版本：" + dto.modelVersionId + "  ｜  紀錄：" + dto.recordId);
    line("驗證時間：" + dto.validatedAt);
    line("本報表只對應上述版本；歷史結果不代表新版已通過。");
    line("用途結論來自原驗證紀錄，不代表反向轉換或第三方認證。");
    current.moveDown();
    for (const key of Object.keys(purposeNames) as (keyof typeof purposeNames)[]) {
      const evaluation = dto.evaluations.find(item => item.purpose === key);
      line(purposeNames[key] + "：" + outcomeNames[evaluation?.outcome ?? "not_validated"], 12);
      if (evaluation?.limitations.length) line("限制：" + evaluation.limitations.length + " 項；完整內容見後續驗證明細。");
    }
    current.moveDown();
    const inventory = dto.inventory;
    const unknown = inventory.observation === "not_run" ||
      (inventory.observation === undefined && inventory.expectedRenderable === null &&
        inventory.convertedRenderable === null && !inventory.missing.length && !inventory.excluded.length);
    line("預期構件：" + (inventory.expectedRenderable ?? "未取得") +
      "  ｜  已轉換：" + (inventory.convertedRenderable ?? "未取得"));
    line("缺漏：" + (unknown ? "尚未盤點" : inventory.missing.length) +
      "  ｜  排除：" + (unknown ? "尚未盤點" : inventory.excluded.length));
    line("轉換器：" + summaryText(dto.converterVersion ?? "未取得") + "  ｜  驗證器：" + summaryText(dto.validatorVersion));
    line("後續頁列出報表明細與構件對照；附件 validation-record.json 與線上／CSV 為相同報表資料。");
    current.addPage();
    line("用途報表與構件明細", 16);
    let count = 0;
    for (const field of fields(dto, "")) {
      line(field, 9);
      if (++count % 25 === 0) await yieldTurn();
    }
    current.file(Buffer.from(JSON.stringify(dto), "utf8"), {
      name: "validation-record.json", type: "application/json", description: "同份用途報表資料",
    });
    current.end();
    await ended;
    if (failure || bytes === 0) throw unavailable();
    return Buffer.concat(chunks);
  } catch {
    throw unavailable();
  } finally {
    doc?.destroy();
    rendering = false;
  }
}
