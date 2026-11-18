(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const BASE = "https://petstore3.swagger.io/api/v3";

  /* ---------- Operations, as the Petstore v3 spec declares them ---------- */
  const petBody = {
    required: ["name", "photoUrls"],
    props: {
      id: { type: "integer", example: 10 },
      name: { type: "string", example: "doggie" },
      category: { type: "object" },
      photoUrls: { type: "array", items: { type: "string" } },
      tags: { type: "array" },
      status: { type: "string", enum: ["available", "pending", "sold"], description: "pet status in the store" },
    },
  };
  const ops = [
    { id: "findPetsByStatus", method: "get", path: "/pet/findByStatus", summary: "Finds Pets by status.",
      params: [{ name: "status", in: "query", required: false, schema: { type: "string", enum: ["available", "pending", "sold"], default: "available" } }],
      sample: { status: "available" } },
    { id: "getPetById", method: "get", path: "/pet/{petId}", summary: "Find pet by ID.",
      params: [{ name: "petId", in: "path", required: true, schema: { type: "integer", format: "int64" } }],
      sample: { petId: 10 } },
    { id: "deletePet", method: "delete", path: "/pet/{petId}", summary: "Deletes a pet.",
      params: [{ name: "api_key", in: "header", required: false, schema: { type: "string" } }, { name: "petId", in: "path", required: true, schema: { type: "integer", format: "int64" } }],
      sample: { petId: 10 } },
    { id: "addPet", method: "post", path: "/pet", summary: "Add a new pet to the store.", params: [], body: petBody,
      sample: { name: "doggie", photoUrls: [], status: "available" } },
    { id: "loginUser", method: "get", path: "/user/login", summary: "Logs user into the system.",
      params: [{ name: "username", in: "query", required: false, schema: { type: "string" } }, { name: "password", in: "query", required: false, schema: { type: "string" } }],
      sample: { username: "theUser" } },
    { id: null, method: "get", path: "/pets/{petId}", summary: null,
      params: [{ name: "petId", in: "path", required: true, schema: { type: "string" } }],
      sample: { petId: "7" }, note: "This one has no operationId and no summary, so the name is made from the method and path, and the description falls back to the method and path." },
  ];

  const opSel = $("#op"), prefixIn = $("#prefix"), fixedIn = $("#fixed");
  opSel.innerHTML = ops.map((o, i) => `<option value="${i}">${o.method.toUpperCase()} ${o.path}${o.id ? ` (${o.id})` : ""}</option>`).join("");

  // Same rules as src/tools.ts
  const sanitize = (raw) => (raw.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "tool").slice(0, 64);
  const toolName = (op, prefix) => {
    const base = op.id || `${op.method}_${op.path.replace(/[{}]/g, "")}`;
    return sanitize(prefix ? `${prefix}_${base}` : base);
  };
  function parseFixed(s) {
    s = s.trim();
    if (!s) return {};
    if (s.startsWith("{")) { try { const o = JSON.parse(s); return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])); } catch { return null; } }
    const out = {};
    for (const part of s.split(",")) {
      const i = part.indexOf("=");
      if (i < 1) return null;
      out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  const j = (v, ind = 0) => {
    const pad = "  ".repeat(ind);
    if (Array.isArray(v)) return v.length ? `[${v.map((x) => j(x, ind + 1)).join(", ")}]` : "[]";
    if (v && typeof v === "object") {
      const ks = Object.keys(v);
      if (!ks.length) return "{}";
      return `{\n${ks.map((k) => `${pad}  <span class="hl">"${esc(k)}"</span>: ${j(v[k], ind + 1)}`).join(",\n")}\n${pad}}`;
    }
    return typeof v === "string" ? `<span class="s">"${esc(v)}"</span>` : esc(JSON.stringify(v));
  };

  function renderTool() {
    const op = ops[+opSel.value];
    const fixed = parseFixed(fixedIn.value);
    const note = $("#conv-note");
    if (fixed === null) { note.textContent = "Fixed params are key=value pairs, comma-separated, or a JSON object."; return; }
    const hidden = new Set(Object.keys(fixed));
    const prefix = prefixIn.value.trim();

    // spec view
    const specObj = { [op.path]: { [op.method]: Object.assign(
      op.id ? { operationId: op.id } : {}, op.summary ? { summary: op.summary } : {},
      op.params.length ? { parameters: op.params.map((p) => ({ name: p.name, in: p.in, required: p.required, schema: p.schema })) } : {},
      op.body ? { requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Pet" } } } } } : {}) } };
    $("#spec-out").innerHTML = j(specObj);

    // tool schema
    const props = {}, required = [], hiddenList = [];
    for (const p of op.params) {
      if (hidden.has(p.name)) { hiddenList.push({ name: p.name, in: p.in }); continue; }
      props[p.name] = p.schema;
      if (p.required) required.push(p.name);
    }
    if (op.body) {
      for (const [k, s] of Object.entries(op.body.props)) {
        if (hidden.has(k)) { hiddenList.push({ name: k, in: "body" }); continue; }
        props[props[k] ? `body_${k}` : k] = s;
        if (op.body.required.includes(k)) required.push(k);
      }
    }
    const tool = { name: toolName(op, prefix), description: op.summary || `${op.method.toUpperCase()} ${op.path}`,
      inputSchema: Object.assign({ type: "object", properties: props }, required.length ? { required } : {}) };
    $("#tool-out").innerHTML = j(tool);
    $("#tool-count").textContent = `1 of ${ops.length} shown`;

    // upstream request
    const args = op.sample;
    let path = op.path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(args[k] ?? `{${k}}`));
    const q = [], hdrs = [], body = {};
    for (const p of op.params) {
      if (hidden.has(p.name)) continue;
      const v = args[p.name];
      if (v === undefined) continue;
      if (p.in === "query") q.push(`${p.name}=${encodeURIComponent(v)}`);
      if (p.in === "header") hdrs.push(`${p.name}: ${v}`);
    }
    if (op.body) for (const k of Object.keys(op.body.props)) if (!hidden.has(k) && args[k] !== undefined) body[k] = args[k];
    // fixed params: declared location, otherwise query
    const declared = new Map([...op.params.map((p) => [p.name, p.in]), ...(op.body ? Object.keys(op.body.props).map((k) => [k, "body"]) : [])]);
    const injected = [];
    for (const k of hidden) {
      const where = declared.get(k) || "query";
      injected.push([k, where]);
      if (where === "query") q.push(`<span class="inj">${esc(k)}=***</span>`);
      if (where === "header") hdrs.push(`<span class="inj">${esc(k)}: ***</span>`);
      if (where === "body") body[k] = "***";
    }
    let req = `<span class="k">${op.method.toUpperCase()}</span> ${esc(BASE + path)}${q.length ? "?" + q.map((x) => x.startsWith("<") ? x : esc(x)).join("&amp;") : ""}`;
    if (hdrs.length) req += "\n" + hdrs.map((h) => h.startsWith("<") ? h : esc(h)).join("\n");
    if (op.body) req += "\n\n" + j(body).replace(/"\*\*\*"/g, '<span class="inj">"***"</span>');
    $("#req-out").innerHTML = `<span class="d">// the model sent ${esc(JSON.stringify(args))}</span>\n` + req;

    let n = op.note ? op.note + " " : "";
    if (hiddenList.length) n += `${hiddenList.map((h) => `<code>${esc(h.name)}</code>`).join(", ")} matched a ${hiddenList[0].in} param in the spec, so it was removed from the schema and is injected there.`;
    const extra = injected.filter(([k]) => !declared.has(k)).map(([k]) => k);
    if (extra.length) n += ` ${extra.map((k) => `<code>${esc(k)}</code>`).join(", ")} isn't declared by this operation, so it goes in the query string.`;
    if (!hidden.size) n += "No fixed params: the model sees every field.";
    note.innerHTML = n.trim();
  }
  [opSel, prefixIn, fixedIn].forEach((el) => el.addEventListener("input", renderTool));
  renderTool();

  /* ---------- Config generator ---------- */
  const gName = $("#g-name"), gUrl = $("#g-url"), gPrefix = $("#g-prefix"), gAuth = $("#g-auth");
  const gOut = $("#g-out"), gWhere = $("#g-where");
  const tabs = $$(".gen-out [role=tab]");
  let target = "desktop";
  const shq = (s) => /^[A-Za-z0-9_./:@=-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
  function renderGen() {
    const name = gName.value.trim() || "my-api";
    const url = gUrl.value.trim() || "./openapi.json";
    const prefix = gPrefix.value.trim();
    const args = ["-y", "@swayam5342/api2mcp", "--url", url, ...(prefix ? ["--prefix", prefix] : [])];
    const headers = '{"Authorization":"Bearer YOUR_TOKEN"}';
    if (target === "desktop") {
      const entry = { command: "npx", args };
      if (gAuth.checked) entry.env = { API_HEADERS: headers };
      gOut.textContent = JSON.stringify({ mcpServers: { [name]: entry } }, null, 2);
      gWhere.textContent = "claude_desktop_config.json (macOS: ~/Library/Application Support/Claude/, Windows: %APPDATA%\\Claude\\)";
    } else {
      gOut.textContent = `claude mcp add ${shq(name)}${gAuth.checked ? ` -e API_HEADERS=${shq(headers)}` : ""} -- npx ${args.map(shq).join(" ")}`;
      gWhere.textContent = "Run in your project, then check it with claude mcp list";
    }
  }
  [gName, gUrl, gPrefix, gAuth].forEach((el) => el.addEventListener("input", renderGen));
  tabs.forEach((t) => t.addEventListener("click", () => {
    target = t.dataset.t;
    tabs.forEach((x) => x.setAttribute("aria-selected", String(x === t)));
    renderGen();
  }));
  renderGen();

  /* ---------- Copy ---------- */
  $$(".copy").forEach((btn) => btn.addEventListener("click", async () => {
    const text = btn.parentElement.querySelector("code").textContent;
    try { await navigator.clipboard.writeText(text); btn.textContent = "Copied"; btn.classList.add("done"); }
    catch { btn.textContent = "Select it"; }
    setTimeout(() => { btn.textContent = "Copy"; btn.classList.remove("done"); }, 1600);
  }));
})();
