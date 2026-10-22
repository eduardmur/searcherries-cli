/**
 * Defensive readers for API JSON. The API adds fields over time and the
 * renderers must keep working on any shape, so nothing here throws.
 */
export type Obj = Record<string, unknown>;

export function isObj(value: unknown): value is Obj {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export const obj = (value: unknown): Obj => (isObj(value) ? value : {});

export const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const objs = (value: unknown): Obj[] => arr(value).filter(isObj);

export const str = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

export const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const isScalar = (value: unknown): boolean =>
  value === null || ["string", "number", "boolean"].includes(typeof value);
