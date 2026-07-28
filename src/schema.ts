import { z } from "zod";
import type { JsonSchema } from "./openapi.js";

const MAX_DEPTH = 12;

/**
 * Convert a (dereferenced) JSON-schema fragment to a zod type. Covers the
 * subset that appears in real-world API specs; anything unrecognized falls
 * back to z.any() so a weird schema never blocks tool registration. Depth is
 * capped to survive circular schemas.
 */
export function jsonSchemaToZod(schema: JsonSchema | undefined, depth = 0): z.ZodTypeAny {
  if (!schema || typeof schema !== "object" || depth > MAX_DEPTH) {
    return z.any();
  }

  let zod = convertCore(schema, depth);

  if (schema.nullable === true) zod = zod.nullable();
  if (typeof schema.description === "string" && schema.description !== "") {
    zod = zod.describe(schema.description);
  }
  return zod;
}

function convertCore(schema: JsonSchema, depth: number): z.ZodTypeAny {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return enumToZod(schema.enum);
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case "string":
      return z.string();
    case "integer":
      return z.number().int();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(jsonSchemaToZod(schema.items as JsonSchema | undefined, depth + 1));
    case "object":
      return objectToZod(schema, depth);
    default:
      // No explicit type: an object-like schema (has properties) still counts.
      if (schema.properties && typeof schema.properties === "object") {
        return objectToZod(schema, depth);
      }
      return z.any();
  }
}

function enumToZod(values: unknown[]): z.ZodTypeAny {
  if (values.every((v): v is string => typeof v === "string")) {
    if (values.length === 1) return z.literal(values[0] as string);
    return z.enum(values as [string, ...string[]]);
  }
  const literals = values.map((v) =>
    z.literal(v as string | number | boolean),
  );
  if (literals.length === 1) return literals[0]!;
  return z.union(literals as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
}

function objectToZod(schema: JsonSchema, depth: number): z.ZodTypeAny {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const [name, propSchema] of Object.entries(properties)) {
    const prop = jsonSchemaToZod(propSchema, depth + 1);
    shape[name] = required.has(name) ? prop : prop.optional();
  }
  if (Object.keys(shape).length === 0) {
    // Free-form object (e.g. additionalProperties or none declared).
    return z.record(z.any());
  }
  return z.object(shape);
}
