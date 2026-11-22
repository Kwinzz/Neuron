import type { JsonValue } from "@/bindings/serde_json/JsonValue";

export type JsonObject = { [key in string]: JsonValue };

export function asObject(v: JsonValue | undefined): JsonObject | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v;
  }
  return null;
}

export function str(obj: JsonObject | null, key: string): string | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

export function num(obj: JsonObject | null, key: string): number | null {
  if (!obj) return null;
  const v = obj[key];
  return typeof v === "number" ? v : null;
}

export function arr(obj: JsonObject | null, key: string): JsonValue[] | null {
  if (!obj) return null;
  const v = obj[key];
  return Array.isArray(v) ? v : null;
}

export function prettyJson(v: JsonValue): string {
  try {
    return JSON.stringify(v, null, 2) ?? "";
  } catch {
    return String(v);
  }
}
