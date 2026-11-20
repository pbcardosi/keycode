import { KeycodeError } from "../util/errors.js";

export interface SchemaValidation {
  valid: boolean;
  errors: string[];
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function validateSchema(value: unknown, schema: unknown, path = "$"): SchemaValidation {
  const errors: string[] = [];
  if (schema === null || typeof schema !== "object") return { valid: true, errors };

  const record = schema as Record<string, unknown>;
  const expectedType = record.type;
  if (typeof expectedType === "string" && typeOf(value) !== expectedType) {
    errors.push(`${path}: expected ${expectedType}, got ${typeOf(value)}`);
    return { valid: false, errors };
  }

  if (Array.isArray(record.enum) && !record.enum.includes(value)) {
    errors.push(`${path}: value is not one of the allowed enum values`);
  }

  if (typeOf(value) === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    const required = Array.isArray(record.required) ? record.required : [];
    for (const key of required) {
      if (!(key in object)) errors.push(`${path}.${String(key)}: required property is missing`);
    }
    const properties = record.properties;
    if (properties !== null && typeof properties === "object") {
      for (const [key, childSchema] of Object.entries(properties as Record<string, unknown>)) {
        if (key in object) {
          const result = validateSchema(object[key], childSchema, `${path}.${key}`);
          errors.push(...result.errors);
        }
      }
    }
  }

  if (typeOf(value) === "array" && record.items !== undefined) {
    const items = value as unknown[];
    items.forEach((item, index) => {
      const result = validateSchema(item, record.items, `${path}[${index}]`);
      errors.push(...result.errors);
    });
  }

  return { valid: errors.length === 0, errors };
}

export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const raw = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new KeycodeError("TOOL_INPUT_INVALID", `Structured output is not valid JSON: ${(error as Error).message}`);
  }
}

export function parseStructuredOutput(text: string, schema: unknown): unknown {
  const value = extractJson(text);
  const validation = validateSchema(value, schema);
  if (!validation.valid) {
    throw new KeycodeError(
      "TOOL_INPUT_INVALID",
      `Structured output did not match the schema: ${validation.errors.join("; ")}`,
    );
  }
  return value;
}
