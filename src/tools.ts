import { z } from "zod";
import type { JsonSchema, NormalizedOperation } from "./openapi.js";
import { jsonSchemaToZod } from "./schema.js";

/** Where a tool-input field goes in the upstream request. */
export type ParamLocation = "path" | "query" | "header" | "body" | "bodyRoot";

/** One field of a tool's input schema, with its upstream destination. */
export interface ToolParam {
  /** Field name as the LLM sees it in the tool input schema. */
  name: string;
  /** Original name upstream (differs from `name` only on collision renames). */
  upstreamName: string;
  in: ParamLocation;
  required: boolean;
}

/** A spec operation ready to register as an MCP tool. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** Lowercase HTTP method. */
  method: string;
  /** Path template as written in the spec, e.g. `/pets/{petId}`. */
  pathTemplate: string;
  params: ToolParam[];
  /**
   * Spec params matched by a fixed-param key: absent from the input schema
   * (the LLM never sees them) but kept here so the proxy can inject the
   * configured value into the right location upstream.
   */
  hiddenParams: ToolParam[];
  /** Zod raw shape for the tool's input (what the MCP SDK takes). */
  inputSchema: Record<string, z.ZodTypeAny>;
}

/** Options for {@link mapOperationsToTools}. */
export interface MapOptions {
  /** Prefix prepended to every tool name (`prefix_name`). */
  toolPrefix?: string;
  /**
   * Params to hide from tool input schemas entirely. Their values are
   * injected by the proxy at request time — the LLM never sees them.
   */
  fixedParams?: Record<string, string>;
}

const MAX_TOOL_NAME_LENGTH = 64;

/** Sanitize to the MCP tool-name charset [A-Za-z0-9_-], collapse runs of _. */
function sanitizeToolName(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned === "" ? "tool" : cleaned;
}

/** Synthesize a name for operations without an operationId: get_pets_petId. */
function synthesizeName(op: NormalizedOperation): string {
  const pathPart = op.path.replace(/[{}]/g, "");
  return `${op.method}_${pathPart}`;
}

function toolDescription(op: NormalizedOperation): string {
  return (
    op.summary?.trim() ||
    op.description?.trim() ||
    `${op.method.toUpperCase()} ${op.path}`
  );
}

/**
 * Map normalized operations to tool definitions: names (operationId or
 * synthesized, prefixed, sanitized, deduped), descriptions, and a flat zod
 * input schema combining path/query/header params and JSON body fields.
 * Fields named in `fixedParams` are omitted from the schema entirely.
 */
export function mapOperationsToTools(
  ops: NormalizedOperation[],
  options: MapOptions = {},
): ToolDefinition[] {
  const hidden = new Set(Object.keys(options.fixedParams ?? {}));
  const usedNames = new Set<string>();
  const tools: ToolDefinition[] = [];

  for (const op of ops) {
    const base = op.operationId?.trim() || synthesizeName(op);
    const prefixed = options.toolPrefix ? `${options.toolPrefix}_${base}` : base;
    let name = sanitizeToolName(prefixed).slice(0, MAX_TOOL_NAME_LENGTH);
    if (usedNames.has(name)) {
      let i = 2;
      let candidate: string;
      do {
        const suffix = `_${i}`;
        candidate = name.slice(0, MAX_TOOL_NAME_LENGTH - suffix.length) + suffix;
        i++;
      } while (usedNames.has(candidate));
      name = candidate;
    }
    usedNames.add(name);

    const params: ToolParam[] = [];
    const hiddenParams: ToolParam[] = [];
    const inputSchema: Record<string, z.ZodTypeAny> = {};

    for (const p of op.params) {
      if (hidden.has(p.name)) {
        hiddenParams.push({ name: p.name, upstreamName: p.name, in: p.in, required: p.required });
        continue;
      }
      let field = jsonSchemaToZod(p.schema);
      if (p.description && !p.schema?.description) field = field.describe(p.description);
      if (!p.required) field = field.optional();
      inputSchema[p.name] = field;
      params.push({ name: p.name, upstreamName: p.name, in: p.in, required: p.required });
    }

    if (op.body) {
      addBodyFields(op, hidden, params, hiddenParams, inputSchema);
    }

    tools.push({
      name,
      description: toolDescription(op),
      method: op.method,
      pathTemplate: op.path,
      params,
      hiddenParams,
      inputSchema,
    });
  }
  return tools;
}

/**
 * Flatten an object body's properties into the top-level input schema. On a
 * name collision with an existing param the body field becomes `body_<name>`
 * (upstreamName keeps the original). Non-object bodies become one `body` field.
 */
function addBodyFields(
  op: NormalizedOperation,
  hidden: Set<string>,
  params: ToolParam[],
  hiddenParams: ToolParam[],
  inputSchema: Record<string, z.ZodTypeAny>,
): void {
  const body = op.body!;
  const schema = body.schema;
  const isObject =
    schema !== undefined &&
    (schema.type === "object" ||
      (schema.type === undefined && typeof schema.properties === "object"));

  if (!isObject || !schema.properties) {
    const fieldName = inputSchema.body === undefined ? "body" : "body_payload";
    let field = jsonSchemaToZod(schema);
    if (!body.required) field = field.optional();
    inputSchema[fieldName] = field;
    params.push({
      name: fieldName,
      upstreamName: "body",
      in: "bodyRoot",
      required: body.required,
    });
    return;
  }

  const properties = schema.properties as Record<string, JsonSchema>;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const [propName, propSchema] of Object.entries(properties)) {
    if (hidden.has(propName)) {
      hiddenParams.push({
        name: propName,
        upstreamName: propName,
        in: "body",
        required: false,
      });
      continue;
    }
    const exposedName = inputSchema[propName] === undefined ? propName : `body_${propName}`;
    if (inputSchema[exposedName] !== undefined) continue; // give up on double collision
    const isRequired = body.required && required.has(propName);
    let field = jsonSchemaToZod(propSchema);
    if (!isRequired) field = field.optional();
    inputSchema[exposedName] = field;
    params.push({
      name: exposedName,
      upstreamName: propName,
      in: "body",
      required: isRequired,
    });
  }
}
