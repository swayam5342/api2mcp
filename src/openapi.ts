import SwaggerParser from "@apidevtools/swagger-parser";

/** Loose JSON-schema shape as found in dereferenced specs. */
export type JsonSchema = Record<string, unknown>;

/** A spec operation normalized across OpenAPI 3.x and Swagger 2.x. */
export interface NormalizedOperation {
  /** Lowercase HTTP method. */
  method: string;
  /** Path template as written in the spec, e.g. `/pets/{petId}`. */
  path: string;
  operationId?: string;
  summary?: string;
  description?: string;
  /** path/query/header parameters (cookie and formData are skipped in v1). */
  params: Array<{
    name: string;
    in: "path" | "query" | "header";
    required: boolean;
    description?: string;
    schema?: JsonSchema;
  }>;
  /** JSON request body, when the operation has one. */
  body?: { schema: JsonSchema | undefined; required: boolean };
}

/** Error thrown when a spec cannot be loaded or parsed. */
export class SpecError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "SpecError";
    if (cause !== undefined) this.cause = cause;
  }
}

const HTTP_METHODS = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
] as const;

type SpecDocument = Record<string, unknown>;

/**
 * Load an OpenAPI 3.x / Swagger 2.x spec from a file path or URL and resolve
 * all $refs. This is the only place the spec leaves disk/network.
 */
export async function loadSpec(url: string): Promise<SpecDocument> {
  try {
    return (await SwaggerParser.dereference(url)) as unknown as SpecDocument;
  } catch (err) {
    throw new SpecError(
      `failed to load spec from ${url}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

function isSwagger2(doc: SpecDocument): boolean {
  return typeof doc.swagger === "string" && doc.swagger.startsWith("2");
}

/**
 * Upstream base URL declared by the spec: `servers[0].url` for 3.x,
 * `scheme://host + basePath` for 2.x. Undefined when the spec doesn't say.
 */
export function baseUrlFromSpec(doc: SpecDocument): string | undefined {
  if (isSwagger2(doc)) {
    if (typeof doc.host !== "string" || doc.host === "") return undefined;
    const schemes = Array.isArray(doc.schemes) ? doc.schemes : [];
    const scheme = typeof schemes[0] === "string" ? schemes[0] : "https";
    const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
    return `${scheme}://${doc.host}${basePath}`;
  }
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  const first = servers[0];
  if (first && typeof first === "object" && typeof (first as SpecDocument).url === "string") {
    return (first as SpecDocument).url as string;
  }
  return undefined;
}

type RawParam = Record<string, unknown>;

function mergeParams(pathLevel: RawParam[], opLevel: RawParam[]): RawParam[] {
  // Operation-level parameters override path-level ones with the same name+in.
  const merged = [...pathLevel];
  for (const p of opLevel) {
    const idx = merged.findIndex((m) => m.name === p.name && m.in === p.in);
    if (idx >= 0) merged[idx] = p;
    else merged.push(p);
  }
  return merged;
}

function normalizeParams(
  raw: RawParam[],
  swagger2: boolean,
): NormalizedOperation["params"] {
  const out: NormalizedOperation["params"] = [];
  for (const p of raw) {
    const where = p.in;
    if (where !== "path" && where !== "query" && where !== "header") continue;
    const param: NormalizedOperation["params"][number] = {
      name: String(p.name),
      in: where,
      required: p.required === true || where === "path",
    };
    if (typeof p.description === "string") param.description = p.description;
    if (swagger2) {
      // 2.x non-body params carry schema keywords directly on the parameter.
      const schema: JsonSchema = {};
      for (const key of ["type", "format", "enum", "items", "default", "minimum", "maximum"]) {
        if (p[key] !== undefined) schema[key] = p[key];
      }
      if (Object.keys(schema).length > 0) param.schema = schema;
    } else if (p.schema && typeof p.schema === "object") {
      param.schema = p.schema as JsonSchema;
    }
    out.push(param);
  }
  return out;
}

function extractBody(
  op: RawParam,
  rawParams: RawParam[],
  swagger2: boolean,
): NormalizedOperation["body"] {
  if (swagger2) {
    const bodyParam = rawParams.find((p) => p.in === "body");
    if (!bodyParam) return undefined;
    return {
      schema: (bodyParam.schema ?? undefined) as JsonSchema | undefined,
      required: bodyParam.required === true,
    };
  }
  const requestBody = op.requestBody as RawParam | undefined;
  if (!requestBody || typeof requestBody !== "object") return undefined;
  const content = requestBody.content as Record<string, RawParam> | undefined;
  if (!content) return undefined;
  const jsonKey = Object.keys(content).find((k) => k.includes("json"));
  if (!jsonKey) return undefined; // non-JSON bodies are out of scope for v1
  return {
    schema: (content[jsonKey]?.schema ?? undefined) as JsonSchema | undefined,
    required: requestBody.required === true,
  };
}

/** Flatten a dereferenced spec into a list of normalized operations. */
export function listOperations(doc: SpecDocument): NormalizedOperation[] {
  const swagger2 = isSwagger2(doc);
  const paths = doc.paths as Record<string, RawParam> | undefined;
  if (!paths || typeof paths !== "object") {
    throw new SpecError("spec has no paths object");
  }
  const ops: NormalizedOperation[] = [];
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object") continue;
    const pathParams = Array.isArray(pathItem.parameters)
      ? (pathItem.parameters as RawParam[])
      : [];
    for (const method of HTTP_METHODS) {
      const op = pathItem[method] as RawParam | undefined;
      if (!op || typeof op !== "object") continue;
      const opParams = Array.isArray(op.parameters) ? (op.parameters as RawParam[]) : [];
      const merged = mergeParams(pathParams, opParams);
      const normalized: NormalizedOperation = {
        method,
        path,
        params: normalizeParams(merged, swagger2),
      };
      if (typeof op.operationId === "string") normalized.operationId = op.operationId;
      if (typeof op.summary === "string") normalized.summary = op.summary;
      if (typeof op.description === "string") normalized.description = op.description;
      const body = extractBody(op, merged, swagger2);
      if (body) normalized.body = body;
      ops.push(normalized);
    }
  }
  return ops;
}
