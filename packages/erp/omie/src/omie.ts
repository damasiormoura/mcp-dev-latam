/**
 * Omie transport and request validation.
 *
 * Omie speaks a JSON-RPC-ish dialect: every call is a POST whose body carries
 * `call`, `app_key`, `app_secret` and a single-element `param` array.
 */

const APP_KEY = process.env.OMIE_APP_KEY || "";
const APP_SECRET = process.env.OMIE_APP_SECRET || "";
const BASE_URL = "https://app.omie.com.br/api/v1";

export async function omieRequest(path: string, call: string, param: unknown[]): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      call,
      app_key: APP_KEY,
      app_secret: APP_SECRET,
      param,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Omie API ${res.status}: ${err}`);
  }
  return res.json();
}

/**
 * Minimal request validation.
 *
 * The Omie API answers a malformed `param` with an HTTP 500 carrying a
 * faultstring, which reaches the agent as an opaque remote failure. Walking the
 * tool's own inputSchema first turns "required field missing" into a local,
 * actionable message — and, since the schemas mirror the documented contract,
 * it catches exactly the mistakes that would otherwise reach Omie.
 */
export function validateArgs(schema: any, value: unknown, path = ""): string[] {
  if (!schema || typeof schema !== "object") return [];
  const here = path || "arguments";
  const errors: string[] = [];

  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`${here} must be an object`];
    }
    const obj = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (obj[key] === undefined || obj[key] === null) {
        errors.push(`${path ? `${path}.` : ""}${key} is required`);
      }
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (obj[key] !== undefined && obj[key] !== null) {
        errors.push(...validateArgs(sub, obj[key], path ? `${path}.${key}` : key));
      }
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${here} must be an array`];
    if (schema.minItems && value.length < schema.minItems) {
      errors.push(`${here} must have at least ${schema.minItems} item(s)`);
    }
    value.forEach((item, i) => errors.push(...validateArgs(schema.items, item, `${here}[${i}]`)));
  }

  return errors;
}
