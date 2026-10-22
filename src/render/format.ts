import { isObj, isScalar, num, type Obj, str } from "../json.js";

export const DASH = "–";

export interface Style {
  bold(text: string): string;
  dim(text: string): string;
}

/** Bold and dim only, and only on a terminal without NO_COLOR. */
export function createStyle(enabled: boolean): Style {
  if (!enabled) {
    return { bold: (text) => text, dim: (text) => text };
  }
  return {
    bold: (text) => `\u001b[1m${text}\u001b[22m`,
    dim: (text) => `\u001b[2m${text}\u001b[22m`,
  };
}

export interface RenderContext {
  style: Style;
  /** Terminal width; Infinity when the output is piped. */
  width: number;
}

export function int(value: unknown): string {
  const n = num(value);
  return n === null ? DASH : Math.round(n).toLocaleString("en-US");
}

export function decimal(value: unknown, digits = 1): string {
  const n = num(value);
  return n === null ? DASH : n.toLocaleString("en-US", { maximumFractionDigits: digits });
}

/** A value already in percent (0–100). */
export function percent(value: unknown, digits = 1): string {
  const n = num(value);
  return n === null ? DASH : `${decimal(n, digits)}%`;
}

/** A ratio from 0 to 1 shown as percent. */
export function ratio(value: unknown, digits = 1): string {
  const n = num(value);
  return n === null ? DASH : percent(n * 100, digits);
}

/** A change in percentage points, with an explicit sign. */
export function points(value: unknown): string {
  const n = num(value);
  if (n === null) {
    return DASH;
  }
  const sign = n > 0 ? "+" : n < 0 ? "−" : "±";
  return `${sign}${decimal(Math.abs(n))} pts`;
}

export function day(value: unknown): string {
  const text = str(value);
  return text ? text.slice(0, 10) : DASH;
}

export function yesNo(value: unknown): string {
  return value === true ? "yes" : value === false ? "no" : DASH;
}

export function truncate(text: string, max: number): string {
  if (max <= 0) {
    return "";
  }
  const chars = [...text];
  return chars.length <= max ? text : `${chars.slice(0, Math.max(1, max - 1)).join("")}…`;
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** "2026-09-23 to 2026-10-22 (last_30_days)" from a period object. */
export function periodLabel(period: unknown): string {
  const p = isObj(period) ? period : {};
  const start = str(p.start);
  const end = str(p.end);
  const key = str(p.key) ?? str(p.source);
  const range = start && end ? `${start} to ${end}` : null;
  if (range && key) {
    return `${range} (${key})`;
  }
  return range ?? key ?? DASH;
}

const ACRONYMS: Record<string, string> = {
  ctr: "CTR",
  url: "URL",
  urls: "URLs",
  id: "ID",
  ai: "AI",
};

/** "high_impression_low_ctr_queries" → "high impression low CTR queries". */
export function words(key: string): string {
  return key
    .split("_")
    .map((word) => ACRONYMS[word] ?? word)
    .join(" ");
}

/** words() with a capital first letter, for headers. */
export function label(key: string): string {
  const text = words(key);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export interface Column<T> {
  header: string;
  value: (row: T) => string;
  align?: "left" | "right";
  /** Shrinks (with an ellipsis) when the table is wider than the terminal. */
  flex?: boolean;
}

const GAP = "  ";
const MIN_FLEX_WIDTH = 12;

/**
 * Aligned columns. On a terminal the table is fitted to its width: flexible
 * columns shrink first (with an ellipsis), then the rightmost columns are left
 * out with a note; piped output keeps every column whole.
 */
export function table<T>(rows: T[], columns: Column<T>[], ctx: RenderContext): string[] {
  if (rows.length === 0) {
    return [];
  }
  const cells = rows.map((row) => columns.map((column) => oneLine(column.value(row))));

  let count = columns.length;
  let widths = fitWidths(columns, cells, count, ctx.width);
  while (count > 2 && totalWidth(widths) > ctx.width) {
    count--;
    widths = fitWidths(columns, cells, count, ctx.width);
  }

  const line = (values: string[]) =>
    values
      .slice(0, count)
      .map((value, index) => {
        const width = widths[index] ?? 0;
        const text = truncate(value, width);
        const pad = " ".repeat(Math.max(0, width - [...text].length));
        return columns[index]?.align === "right" ? pad + text : text + pad;
      })
      .join(GAP)
      .trimEnd();

  const hidden = columns.length - count;
  return [
    ctx.style.bold(line(columns.map((column) => column.header))),
    ...cells.map(line),
    ...(hidden > 0
      ? [
          ctx.style.dim(
            `${hidden} more ${hidden === 1 ? "column" : "columns"} not shown; --json prints every field.`,
          ),
        ]
      : []),
  ];
}

function totalWidth(widths: number[]): number {
  return widths.reduce((sum, width) => sum + width, 0) + GAP.length * (widths.length - 1);
}

/** Natural widths of the first `count` columns, with flexible ones shrunk towards `limit`. */
function fitWidths<T>(
  columns: Column<T>[],
  cells: string[][],
  count: number,
  limit: number,
): number[] {
  const widths = columns
    .slice(0, count)
    .map((column, index) =>
      Math.max([...column.header].length, ...cells.map((line) => [...(line[index] ?? "")].length)),
    );
  const flexible = columns.slice(0, count).flatMap((column, index) => (column.flex ? [index] : []));
  while (Number.isFinite(limit) && totalWidth(widths) > limit) {
    const widest = flexible
      .filter((index) => (widths[index] ?? 0) > MIN_FLEX_WIDTH)
      .sort((a, b) => (widths[b] ?? 0) - (widths[a] ?? 0))[0];
    if (widest === undefined) {
      break;
    }
    widths[widest] = Math.max(MIN_FLEX_WIDTH, (widths[widest] ?? 0) - (totalWidth(widths) - limit));
  }
  return widths;
}

/** Indents every line of a block, for nested sections. */
export function indent(lines: string[], by = "  "): string[] {
  return lines.map((line) => (line === "" ? line : `${by}${line}`));
}

export function keyValues(pairs: [string, string][], ctx: RenderContext): string[] {
  const visible = pairs.filter(([, value]) => value !== "");
  const width = Math.max(0, ...visible.map(([key]) => [...key].length));
  return visible.map(([key, value]) => `${ctx.style.dim(key.padEnd(width))}  ${value}`);
}

/**
 * Formats one scalar of an unknown dataset row by its key: ratios as percent,
 * positions with one decimal, counts with thousands separators.
 */
export function cell(key: string, value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return DASH;
  }
  if (typeof value === "boolean") {
    return yesNo(value);
  }
  if (typeof value === "number") {
    if (/(^|_)ctr($|_)/.test(key) || key.endsWith("_rate") || key.startsWith("share_of")) {
      return ratio(value);
    }
    if (key.endsWith("percentage") || key.endsWith("_share") || key.endsWith("_percent")) {
      return percent(value);
    }
    if (key.includes("position")) {
      return decimal(value);
    }
    return Number.isInteger(value) ? int(value) : decimal(value, 2);
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return DASH;
    }
    return value.every(isScalar) ? value.map(String).join(", ") : `${value.length} items`;
  }
  if (isObj(value)) {
    const entries = Object.entries(value);
    return entries.every(([, inner]) => isScalar(inner))
      ? entries.map(([inner, innerValue]) => `${inner} ${cell(inner, innerValue)}`).join(", ")
      : `${entries.length} fields`;
  }
  return String(value);
}

const TEXT_KEYS = ["query", "page", "url", "path", "question", "competitor_name", "title"];

/**
 * A table for rows whose shape the CLI does not know: every key becomes a
 * column, in the order the API sends them.
 */
export function genericTable(rows: Obj[], ctx: RenderContext): string[] {
  const keys: string[] = [];
  for (const row of rows.slice(0, 50)) {
    for (const key of Object.keys(row)) {
      if (!keys.includes(key)) {
        keys.push(key);
      }
    }
  }
  const columns = keys.map(
    (key): Column<Obj> => ({
      header: label(key),
      value: (row) => cell(key, row[key]),
      align: rows.some((row) => typeof row[key] === "number") ? "right" : "left",
      flex:
        TEXT_KEYS.includes(key) ||
        rows.some((row) => {
          const value = row[key];
          return typeof value === "string" && value.length > 40;
        }),
    }),
  );

  return table(rows, columns, ctx);
}
