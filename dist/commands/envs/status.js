"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/commands/envs/status.ts
var status_exports = {};
__export(status_exports, {
  default: () => EnvsStatus
});
module.exports = __toCommonJS(status_exports);
var import_node_fs2 = require("node:fs");
var import_node_path2 = require("node:path");
var import_core = require("@oclif/core");

// src/lib/net.ts
var import_node_net = __toESM(require("node:net"));
var import_node_tls = __toESM(require("node:tls"));
function proxyFromEnv() {
  const raw = process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy;
  if (raw === void 0 || raw === "") return void 0;
  const url = new URL(raw);
  const proxy = { host: url.hostname, port: Number(url.port === "" ? 3128 : url.port) };
  if (url.username !== "") {
    proxy.auth = Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString(
      "base64"
    );
  }
  return proxy;
}
function connect(proxy, host, port, timeoutMs) {
  if (proxy === void 0) {
    return new Promise((resolve, reject) => {
      const socket = import_node_net.default.connect(port, host);
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`connect to ${host}:${port} timed out`));
      }, timeoutMs);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve(socket);
      });
    });
  }
  return new Promise((resolve, reject) => {
    const socket = import_node_net.default.connect(proxy.port, proxy.host);
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`CONNECT ${host}:${port} through ${proxy.host}:${proxy.port} timed out`));
    }, timeoutMs);
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once("connect", () => {
      const auth = proxy.auth === void 0 ? "" : `Proxy-Authorization: Basic ${proxy.auth}\r
`;
      socket.write(`CONNECT ${host}:${port} HTTP/1.1\r
Host: ${host}:${port}\r
${auth}\r
`);
    });
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      socket.removeListener("data", onData);
      clearTimeout(timer);
      const statusLine = buffer.subarray(0, headerEnd).toString().split("\r\n")[0] ?? "";
      if (!/^HTTP\/1\.[01] 200/.test(statusLine)) {
        socket.destroy();
        reject(new Error(`proxy refused CONNECT ${host}:${port}: ${statusLine}`));
        return;
      }
      const leftover = buffer.subarray(headerEnd + 4);
      if (leftover.length > 0) socket.unshift(leftover);
      resolve(socket);
    };
    socket.on("data", onData);
  });
}
async function httpsRequest(url, options = {}) {
  const target = new URL(url);
  const port = Number(target.port === "" ? 443 : target.port);
  const timeoutMs = options.timeoutMs ?? 6e4;
  const tcp = await connect(proxyFromEnv(), target.hostname, port, timeoutMs);
  const secure = import_node_tls.default.connect({ socket: tcp, servername: target.hostname });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      secure.destroy();
      reject(new Error(`${options.method ?? "GET"} ${url} timed out`));
    }, timeoutMs);
    secure.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    secure.once("secureConnect", () => {
      const body = options.body ?? "";
      const headers = Object.entries({
        Host: target.hostname,
        "User-Agent": "shopify-cli-envs",
        Connection: "close",
        ...body === "" ? {} : { "Content-Length": String(Buffer.byteLength(body)) },
        ...options.headers
      }).map(([name, value]) => `${name}: ${value}`).join("\r\n");
      secure.write(
        `${options.method ?? "GET"} ${target.pathname}${target.search} HTTP/1.1\r
${headers}\r
\r
${body}`
      );
    });
    let buffer = Buffer.alloc(0);
    let settled = false;
    const finish = () => {
      if (settled) return;
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`${url} answered without headers`));
        return;
      }
      const head = buffer.subarray(0, headerEnd).toString();
      const statusLine = head.split("\r\n")[0] ?? "";
      const status = Number(statusLine.split(" ")[1] ?? "0");
      let body = buffer.subarray(headerEnd + 4);
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        const parts = [];
        let offset = 0;
        while (offset < body.length) {
          const lineEnd = body.indexOf("\r\n", offset);
          if (lineEnd === -1) break;
          const size = Number.parseInt(body.subarray(offset, lineEnd).toString(), 16);
          if (Number.isNaN(size) || size === 0) break;
          parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
          offset = lineEnd + 2 + size + 2;
        }
        body = Buffer.concat(parts);
      }
      settled = true;
      clearTimeout(timer);
      secure.destroy();
      resolve({ status, body: body.toString() });
    };
    const complete = () => {
      const headerEnd = buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return false;
      const head = buffer.subarray(0, headerEnd).toString();
      const lengthMatch = /content-length:\s*(\d+)/i.exec(head);
      if (lengthMatch !== null) {
        return buffer.length >= headerEnd + 4 + Number(lengthMatch[1]);
      }
      if (/transfer-encoding:\s*chunked/i.test(head)) {
        return buffer.includes("\r\n0\r\n", headerEnd);
      }
      return false;
    };
    secure.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (complete()) finish();
    });
    secure.on("end", finish);
  });
}

// src/lib/adapters/dokploy.ts
function baseUrl() {
  return (process.env.DOKPLOY_URL ?? "https://app.dokploy.com").replace(/\/$/, "");
}
function apiKey() {
  const key = process.env.DOKPLOY_API_KEY ?? "";
  if (key === "") throw new Error("DOKPLOY_API_KEY is unset");
  return key;
}
async function get(path) {
  const response = await httpsRequest(`${baseUrl()}/api/${path}`, { headers: { "x-api-key": apiKey() } });
  if (response.status !== 200) {
    throw new Error(`GET ${path} answered ${response.status}: ${response.body.slice(0, 200)}`);
  }
  return JSON.parse(response.body);
}
async function post(path, payload) {
  const response = await httpsRequest(`${baseUrl()}/api/${path}`, {
    method: "POST",
    headers: { "x-api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (response.status !== 200) {
    throw new Error(`POST ${path} answered ${response.status}: ${response.body.slice(0, 300)}`);
  }
}
var POLL_MS = 1e4;
var TIMEOUT_MS = 15 * 6e4;
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
var DokployTarget = class {
  constructor(appId) {
    this.appId = appId;
  }
  describe() {
    return `dokploy application ${this.appId}`;
  }
  async status() {
    if ((process.env.DOKPLOY_API_KEY ?? "") === "") return `${this.appId} (DOKPLOY_API_KEY unset, status unknown)`;
    const app = await get(`application.one?applicationId=${encodeURIComponent(this.appId)}`);
    return `${app.name} \u2014 ${app.applicationStatus}`;
  }
  async pushEnv(blob) {
    const app = await get(`application.one?applicationId=${encodeURIComponent(this.appId)}`);
    await post("application.saveEnvironment", {
      applicationId: app.applicationId,
      env: blob,
      buildArgs: app.buildArgs ?? null,
      buildSecrets: app.buildSecrets ?? null,
      createEnvFile: app.createEnvFile ?? true
    });
  }
  async deploy(title) {
    const list = () => get(`deployment.all?applicationId=${encodeURIComponent(this.appId)}`);
    const known = new Set((await list()).map((deployment) => deployment.deploymentId));
    await post("application.deploy", { applicationId: this.appId, title });
    const startedAt = Date.now();
    for (; ; ) {
      if (Date.now() - startedAt > TIMEOUT_MS) return { ok: false, detail: "timed out waiting for the deployment" };
      await sleep(POLL_MS);
      const fresh = (await list()).filter((deployment) => !known.has(deployment.deploymentId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (fresh === void 0 || fresh.status === "running") continue;
      if (fresh.status === "done") return { ok: true, detail: `deployment ${fresh.deploymentId} done` };
      const logs = await get(
        `deployment.readLogs?deploymentId=${encodeURIComponent(fresh.deploymentId)}&tail=40`
      ).catch(() => "(logs unavailable)");
      const text = typeof logs === "string" ? logs : logs.data ?? "";
      return { ok: false, detail: `deployment ${fresh.deploymentId} ended ${fresh.status}
${text}` };
    }
  }
};
var dokployAdapter = {
  name: "dokploy",
  requiredConfig: ["app_id"],
  create(config) {
    const appId = config.app_id ?? "";
    if (appId === "") throw new Error("dokploy adapter needs app_id");
    return new DokployTarget(appId);
  }
};

// src/lib/adapters/index.ts
var ADAPTERS = [dokployAdapter];
function adapterNames() {
  return ADAPTERS.map((adapter) => adapter.name);
}
function findAdapter(name) {
  const adapter = ADAPTERS.find((entry) => entry.name === name);
  if (adapter === void 0) {
    throw new Error(`unknown deploy adapter "${name}"; available: ${adapterNames().join(", ")}`);
  }
  return adapter;
}
function resolveDeployConfig(environment, tiers) {
  if (environment.deploy === void 0) {
    throw new Error(`environment "${environment.name}" declares no [environments.${environment.name}.deploy] table`);
  }
  const adapter = findAdapter(environment.deploy.adapter);
  const config = {};
  const missing = [];
  for (const [key, value] of Object.entries(environment.deploy.config)) {
    if (value.startsWith("@")) {
      const resolved = tiers.get(value.slice(1)) ?? "";
      if (resolved === "") missing.push(`${key} (${value})`);
      config[key] = resolved;
    } else {
      config[key] = value;
    }
  }
  for (const key of adapter.requiredConfig) {
    if (!(key in config)) missing.push(`${key} (required by ${adapter.name})`);
  }
  return { adapter, config, missing };
}

// src/lib/manifest.ts
var import_node_fs = require("node:fs");
var import_node_path = require("node:path");

// node_modules/smol-toml/dist/date.js
var DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class _TomlDate extends Date {
  #hasDate = false;
  #hasTime = false;
  #offset = null;
  constructor(date) {
    let hasDate = true;
    let hasTime = true;
    let offset = "Z";
    if (typeof date === "string") {
      let match = date.match(DATE_TIME_RE);
      if (match) {
        if (!match[1]) {
          hasDate = false;
          date = `0000-01-01T${date}`;
        }
        hasTime = !!match[2];
        hasTime && date[10] === " " && (date = date.replace(" ", "T"));
        if (match[2] && +match[2] > 23) {
          date = "";
        } else {
          offset = match[3] || null;
          date = date.toUpperCase();
          if (!offset && hasTime)
            date += "Z";
        }
      } else {
        date = "";
      }
    }
    super(date);
    if (!isNaN(this.getTime())) {
      this.#hasDate = hasDate;
      this.#hasTime = hasTime;
      this.#offset = offset;
    }
  }
  isDateTime() {
    return this.#hasDate && this.#hasTime;
  }
  isLocal() {
    return !this.#hasDate || !this.#hasTime || !this.#offset;
  }
  isDate() {
    return this.#hasDate && !this.#hasTime;
  }
  isTime() {
    return this.#hasTime && !this.#hasDate;
  }
  isValid() {
    return this.#hasDate || this.#hasTime;
  }
  toISOString() {
    let iso = super.toISOString();
    if (this.isDate())
      return iso.slice(0, 10);
    if (this.isTime())
      return iso.slice(11, 23);
    if (this.#offset === null)
      return iso.slice(0, -1);
    if (this.#offset === "Z")
      return iso;
    let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
    offset = this.#offset[0] === "-" ? offset : -offset;
    let offsetDate = new Date(this.getTime() - offset * 6e4);
    return offsetDate.toISOString().slice(0, -1) + this.#offset;
  }
  static wrapAsOffsetDateTime(jsDate, offset = "Z") {
    let date = new _TomlDate(jsDate);
    date.#offset = offset;
    return date;
  }
  static wrapAsLocalDateTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#offset = null;
    return date;
  }
  static wrapAsLocalDate(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasTime = false;
    date.#offset = null;
    return date;
  }
  static wrapAsLocalTime(jsDate) {
    let date = new _TomlDate(jsDate);
    date.#hasDate = false;
    date.#offset = null;
    return date;
  }
};

// node_modules/smol-toml/dist/error.js
function getLineColFromPtr(string, ptr) {
  let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
  return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
  let lines = string.split(/\r\n|\n|\r/g);
  let codeblock = "";
  let numberLen = (Math.log10(line + 1) | 0) + 1;
  for (let i = line - 1; i <= line + 1; i++) {
    let l = lines[i - 1];
    if (!l)
      continue;
    codeblock += i.toString().padEnd(numberLen, " ");
    codeblock += ":  ";
    codeblock += l;
    codeblock += "\n";
    if (i === line) {
      codeblock += " ".repeat(numberLen + column + 2);
      codeblock += "^\n";
    }
  }
  return codeblock;
}
var TomlError = class extends Error {
  line;
  column;
  codeblock;
  constructor(message, options) {
    const [line, column] = getLineColFromPtr(options.toml, options.ptr);
    const codeblock = makeCodeBlock(options.toml, line, column);
    super(`Invalid TOML document: ${message}

${codeblock}`, options);
    this.line = line;
    this.column = column;
    this.codeblock = codeblock;
  }
};

// node_modules/smol-toml/dist/util.js
function indexOfNewline(str, start = 0) {
  let idx = str.indexOf("\n", start);
  if (str.charCodeAt(idx - 1) === 13)
    idx--;
  return idx;
}
function skipComment(ctx) {
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 10)
      break;
    if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10) {
      ctx.p++;
      break;
    }
    if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in comments", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
  }
}
function skipVoid(ctx, banNewLines, banComments) {
  let c;
  while (1) {
    while ((c = ctx.s.charCodeAt(ctx.p)) === 32 || c === 9 || !banNewLines && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10))
      ctx.p++;
    if (banComments || c !== 35)
      break;
    skipComment(ctx);
  }
}
function skipUntil(ctx, sep, end) {
  let ptr = ctx.p;
  if (!end) {
    ptr = indexOfNewline(ctx.s, ptr);
    ctx.p = ptr < 0 ? ctx.s.length : ptr;
    return;
  }
  for (; ctx.p < ctx.s.length; ctx.p++) {
    let c = ctx.s.charCodeAt(ctx.p);
    if (c === 35) {
      skipComment(ctx);
    } else if (c === end || c === sep) {
      return;
    }
  }
  throw new TomlError("cannot find end of structure", {
    toml: ctx.s,
    ptr
  });
}

// node_modules/smol-toml/dist/primitive.js
var INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
var FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
var LEADING_ZERO = /^[+-]?0[0-9_]/;
function parseString(ctx) {
  let start = ctx.p;
  let c = ctx.s.charCodeAt(ctx.p++);
  let first = c;
  let isLiteral = c === 39;
  let isMultiline = c === ctx.s.charCodeAt(ctx.p) && c === ctx.s.charCodeAt(ctx.p + 1);
  if (isMultiline) {
    if ((c = ctx.s.charCodeAt(ctx.p += 2)) === 10)
      ctx.p++;
    else if (c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)
      ctx.p += 2;
  }
  let parsed = "";
  let sliceStart = ctx.p;
  let state = 0;
  for (; ctx.p < ctx.s.length; ctx.p++) {
    c = ctx.s.charCodeAt(ctx.p);
    if (isMultiline && (c === 10 || c === 13 && ctx.s.charCodeAt(ctx.p + 1) === 10)) {
      state = state && 3;
    } else if (c < 32 && c !== 9 || c === 127) {
      throw new TomlError("control characters are not allowed in strings", {
        toml: ctx.s,
        ptr: ctx.p
      });
    } else if ((!state || state === 3) && c === first && (!isMultiline || ctx.s.charCodeAt(ctx.p + 1) === first && ctx.s.charCodeAt(ctx.p + 2) === first)) {
      if (isMultiline) {
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
        if (ctx.s.charCodeAt(ctx.p + 3) === first)
          ctx.p++;
      }
      if (!state)
        parsed += ctx.s.slice(sliceStart, ctx.p);
      ctx.p += isMultiline ? 3 : 1;
      return parsed;
    } else if (!state) {
      if (!isLiteral && c === 92) {
        parsed += ctx.s.slice(sliceStart, sliceStart = ctx.p);
        state = 1;
      }
    } else if (state === 1) {
      if (c === 120 || c === 117 || c === 85) {
        let value = 0;
        let len = c === 120 ? 2 : c === 117 ? 4 : 8;
        for (let j = 0; j < len; j++, ctx.p++) {
          let hex = ctx.s.charCodeAt(ctx.p + 1);
          let digit = (
            /* 0-9 */
            hex >= 48 && hex <= 57 ? hex - 48 : (
              /* A-F */
              hex >= 65 && hex <= 70 ? hex - 65 + 10 : (
                /* a-f */
                hex >= 97 && hex <= 102 ? hex - 97 + 10 : -1
              )
            )
          );
          if (digit < 0)
            throw new TomlError("invalid non-hex character in unicode escape", { toml: ctx.s, ptr: ctx.p + 1 });
          value = value << 4 | digit;
        }
        if (value < 0 || value > 1114111 || value >= 55296 && value <= 57343) {
          throw new TomlError("invalid unicode escape", { toml: ctx.s, ptr: ctx.p });
        }
        parsed += String.fromCodePoint(value);
        sliceStart = ctx.p + 1;
        state = 0;
      } else if (c === 32 || c === 9) {
        state = 2;
      } else {
        if (c === 98)
          parsed += "\b";
        else if (c === 116)
          parsed += "	";
        else if (c === 110)
          parsed += "\n";
        else if (c === 102)
          parsed += "\f";
        else if (c === 114)
          parsed += "\r";
        else if (c === 101)
          parsed += "\x1B";
        else if (c === 34)
          parsed += '"';
        else if (c === 92)
          parsed += "\\";
        else
          throw new TomlError("unrecognized escape sequence", { toml: ctx.s, ptr: ctx.p });
        sliceStart = ctx.p + 1;
        state = 0;
      }
    } else if (c !== 32 && c !== 9) {
      if (state === 2) {
        throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
          toml: ctx.s,
          ptr: sliceStart
        });
      }
      state = !isLiteral && c === 92 ? 1 : 0;
      sliceStart = ctx.p;
    }
  }
  throw new TomlError("unfinished string", { toml: ctx.s, ptr: start });
}
function sliceAndTrimEndOf(ctx, start, end) {
  let value = ctx.s.slice(start, end);
  let commentIdx = value.indexOf("#");
  if (commentIdx > 0) {
    skipComment({ s: value, p: commentIdx, d: 0 });
    value = value.slice(0, commentIdx);
  }
  return value.trimEnd();
}
function parseValue(ctx, integersAsBigInt, end) {
  let ptr = ctx.p;
  let err = { toml: ctx.s, ptr };
  skipUntil(ctx, 44, end);
  let value = sliceAndTrimEndOf(ctx, ptr, ctx.p);
  if (!value)
    throw new TomlError("incomplete declaration: value expected", err);
  if (value === "-inf")
    return -Infinity;
  if (value === "inf" || value === "+inf")
    return Infinity;
  if (value === "nan" || value === "+nan" || value === "-nan")
    return NaN;
  if (value === "-0")
    return integersAsBigInt ? 0n : 0;
  let isInt = INT_REGEX.test(value);
  if (isInt || FLOAT_REGEX.test(value)) {
    if (LEADING_ZERO.test(value)) {
      throw new TomlError("leading zeroes are not allowed", err);
    }
    value = value.replace(/_/g, "");
    let numeric = +value;
    if (isNaN(numeric)) {
      throw new TomlError("invalid number", err);
    }
    if (isInt) {
      if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) {
        throw new TomlError("integer value cannot be represented losslessly", err);
      }
      if (isInt || integersAsBigInt === true)
        numeric = BigInt(value);
    }
    return numeric;
  }
  const date = new TomlDate(value);
  if (!date.isValid())
    throw new TomlError("invalid value", err);
  return date;
}

// node_modules/smol-toml/dist/extract.js
function extractValue(ctx, end, integersAsBigInt) {
  let ptr = ctx.p;
  let c = ctx.s.charCodeAt(ptr);
  if (c === 91 || c === 123) {
    if (!ctx.d--) {
      throw new TomlError("document contains excessively nested structures. aborting.", {
        toml: ctx.s,
        ptr
      });
    }
    let value = c === 91 ? parseArray(ctx, integersAsBigInt) : parseInlineTable(ctx, integersAsBigInt);
    ctx.d++;
    return value;
  }
  if (c === 34 || c === 39) {
    return parseString(ctx);
  }
  if (c === 116) {
    if (ctx.s.charCodeAt(++ctx.p) !== 114 || ctx.s.charCodeAt(++ctx.p) !== 117 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return true;
  }
  if (c === 102) {
    if (ctx.s.charCodeAt(++ctx.p) !== 97 || ctx.s.charCodeAt(++ctx.p) !== 108 || ctx.s.charCodeAt(++ctx.p) !== 115 || ctx.s.charCodeAt(++ctx.p) !== 101)
      throw new TomlError("invalid value", { toml: ctx.s, ptr });
    ctx.p++;
    return false;
  }
  return parseValue(ctx, integersAsBigInt, end);
}

// node_modules/smol-toml/dist/struct.js
var KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(ctx, end = "=") {
  let start = ctx.p;
  let dot = start - 1;
  let parsed = [];
  let endPtr = ctx.s.indexOf(end, start);
  if (endPtr < 0) {
    throw new TomlError("incomplete key-value: cannot find end of key", {
      toml: ctx.s,
      ptr: start
    });
  }
  do {
    let c = ctx.s.charCodeAt(ctx.p = ++dot);
    if (c !== 32 && c !== 9) {
      if (c === 34 || c === 39) {
        if (c === ctx.s.charCodeAt(ctx.p + 1) && c === ctx.s.charCodeAt(ctx.p + 2)) {
          throw new TomlError("multiline strings are not allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        let part = parseString(ctx);
        dot = ctx.s.indexOf(".", ctx.p);
        let strEnd = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        let newLine = indexOfNewline(strEnd);
        if (newLine > -1) {
          throw new TomlError("newlines are not allowed in keys", {
            toml: ctx.s,
            ptr: newLine
          });
        }
        if (strEnd.trimStart()) {
          throw new TomlError("found extra tokens after the string part", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        if (endPtr < ctx.p) {
          endPtr = ctx.s.indexOf(end, ctx.p);
          if (endPtr < 0) {
            throw new TomlError("incomplete key-value: cannot find end of key", {
              toml: ctx.s,
              ptr: start
            });
          }
        }
        parsed.push(part);
      } else {
        dot = ctx.s.indexOf(".", ctx.p);
        let part = ctx.s.slice(ctx.p, dot < 0 || dot > endPtr ? endPtr : dot);
        if (!KEY_PART_RE.test(part)) {
          throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
            toml: ctx.s,
            ptr: ctx.p
          });
        }
        parsed.push(part.trimEnd());
      }
    }
  } while (dot + 1 && dot < endPtr);
  ctx.p = endPtr + 1;
  skipVoid(ctx, true, true);
  return parsed;
}
function parseInlineTable(ctx, integersAsBigInt) {
  let res = {};
  let seen = /* @__PURE__ */ new Set();
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 125) {
      ctx.p++;
      return res;
    }
    let k;
    let t = res;
    let hasOwn = false;
    let p = ctx.p;
    let key = parseKey(ctx);
    for (let i = 0; i < key.length; i++) {
      if (i)
        t = hasOwn ? t[k] : t[k] = {};
      k = key[i];
      if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) {
        throw new TomlError("trying to redefine an already defined value", {
          toml: ctx.s,
          ptr: p
        });
      }
      if (!hasOwn && k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
      }
    }
    if (hasOwn) {
      throw new TomlError("trying to redefine an already defined value", {
        toml: ctx.s,
        ptr: ctx.p
      });
    }
    let value = extractValue(ctx, 125, integersAsBigInt);
    seen.add(t[k] = value);
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 125) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished table encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}
function parseArray(ctx, integersAsBigInt) {
  let res = [];
  let c;
  ctx.p++;
  while (ctx.p < ctx.s.length) {
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p)) === 93) {
      ctx.p++;
      return res;
    }
    res.push(extractValue(ctx, 93, integersAsBigInt));
    skipVoid(ctx);
    if ((c = ctx.s.charCodeAt(ctx.p++)) === 93) {
      return res;
    }
    if (c !== 44) {
      throw new TomlError("expected comma or end of structure", { toml: ctx.s, ptr: ctx.p - 1 });
    }
  }
  throw new TomlError("unfinished array encountered", {
    toml: ctx.s,
    ptr: ctx.p
  });
}

// node_modules/smol-toml/dist/parse.js
function peekTable(key, table, meta, type) {
  let t = table;
  let m = meta;
  let k;
  let hasOwn = false;
  let state;
  for (let i = 0; i < key.length; i++) {
    if (i) {
      t = hasOwn ? t[k] : t[k] = {};
      m = (state = m[k]).c;
      if (type === 0 && (state.t === 1 || state.t === 2)) {
        return null;
      }
      if (state.t === 2) {
        let l = t.length - 1;
        t = t[l];
        m = m[l].c;
      }
    }
    k = key[i];
    if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) {
      return null;
    }
    if (!hasOwn) {
      if (k === "__proto__") {
        Object.defineProperty(t, k, { enumerable: true, configurable: true, writable: true });
        Object.defineProperty(m, k, { enumerable: true, configurable: true, writable: true });
      }
      m[k] = {
        t: i < key.length - 1 && type === 2 ? 3 : type,
        d: false,
        i: 0,
        c: {}
      };
    }
  }
  state = m[k];
  if (state.t !== type && !(type === 1 && state.t === 3)) {
    return null;
  }
  if (type === 2) {
    if (!state.d) {
      state.d = true;
      t[k] = [];
    }
    t[k].push(t = {});
    state.c[state.i++] = state = { t: 1, d: false, i: 0, c: {} };
  }
  if (state.d) {
    return null;
  }
  state.d = true;
  if (type === 1) {
    t = hasOwn ? t[k] : t[k] = {};
  } else if (type === 0 && hasOwn) {
    return null;
  }
  return [k, t, state.c];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
  let ctx = { s: toml, p: 0, d: maxDepth };
  let res = {};
  let meta = {};
  let tmp;
  let tbl = res;
  let m = meta;
  skipVoid(ctx);
  while (ctx.p < toml.length) {
    if (toml.charCodeAt(ctx.p) === 91) {
      let isTableArray = toml.charCodeAt(++ctx.p) === 91;
      tmp = ctx.p += +isTableArray;
      let k = parseKey(ctx, "]");
      if (isTableArray) {
        if (toml.charCodeAt(ctx.p - 1) !== 93) {
          throw new TomlError("expected end of table declaration", {
            toml,
            ptr: ctx.p - 1
          });
        }
        ctx.p++;
      }
      let p = peekTable(
        k,
        res,
        meta,
        isTableArray ? 2 : 1
        /* Type.EXPLICIT */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      m = p[2];
      tbl = p[1];
    } else {
      tmp = ctx.p;
      let k = parseKey(ctx);
      let p = peekTable(
        k,
        tbl,
        m,
        0
        /* Type.DOTTED */
      );
      if (!p) {
        throw new TomlError("trying to redefine an already defined table or value", {
          toml,
          ptr: tmp
        });
      }
      p[1][p[0]] = extractValue(ctx, void 0, integersAsBigInt);
    }
    skipVoid(ctx, true);
    if (ctx.p < toml.length && (tmp = toml.charCodeAt(ctx.p)) !== 10 && tmp !== 13) {
      throw new TomlError("each key-value declaration must be followed by an end-of-line", {
        toml,
        ptr: ctx.p
      });
    }
    skipVoid(ctx);
  }
  return res;
}

// src/lib/manifest.ts
var MANIFEST_FILE = "envs.toml";
function manifestPath(root) {
  return (0, import_node_path.join)(root, MANIFEST_FILE);
}
function hasManifest(root) {
  return (0, import_node_fs.existsSync)(manifestPath(root));
}
function fail(field, problem) {
  throw new Error(`${MANIFEST_FILE}: ${field} ${problem}`);
}
function asString(value, field) {
  if (typeof value !== "string") fail(field, "must be a string");
  return value;
}
var ENVIRONMENT_KEYS = /* @__PURE__ */ new Set([
  "config",
  "client_id",
  "store",
  "url",
  "protected",
  "deploy",
  "env"
]);
function loadManifest(root) {
  const path = manifestPath(root);
  if (!(0, import_node_fs.existsSync)(path)) fail("file", `not found at ${path}`);
  let raw;
  try {
    raw = parse((0, import_node_fs.readFileSync)(path, "utf8"));
  } catch (error) {
    fail("file", `does not parse as TOML: ${error instanceof Error ? error.message : String(error)}`);
  }
  const tiers = Array.isArray(raw.tiers) ? raw.tiers.map((t) => asString(t, "tiers[]")) : [];
  if (tiers.length === 0) fail("tiers", "must list at least one tier file");
  const envTable = raw.environments;
  if (typeof envTable !== "object" || envTable === null) {
    fail("environments", "must be a table with one entry per environment");
  }
  const environments = [];
  for (const [name, entry] of Object.entries(envTable)) {
    if (typeof entry !== "object" || entry === null) fail(`environments.${name}`, "must be a table");
    const record = entry;
    for (const key of Object.keys(record)) {
      if (!ENVIRONMENT_KEYS.has(key)) fail(`environments.${name}.${key}`, "is not a recognized field");
    }
    if (record.config === void 0) fail(`environments.${name}.config`, "is required");
    const env = {};
    if (record.env !== void 0) {
      if (typeof record.env !== "object" || record.env === null) fail(`environments.${name}.env`, "must be a table");
      for (const [key, value] of Object.entries(record.env)) {
        env[key] = asString(value, `environments.${name}.env.${key}`);
      }
    }
    let deploy;
    if (record.deploy !== void 0) {
      if (typeof record.deploy !== "object" || record.deploy === null) {
        fail(`environments.${name}.deploy`, "must be a table");
      }
      const table = record.deploy;
      if (table.adapter === void 0) fail(`environments.${name}.deploy.adapter`, "is required");
      const config = {};
      for (const [key, value] of Object.entries(table)) {
        if (key === "adapter") continue;
        config[key] = asString(value, `environments.${name}.deploy.${key}`);
      }
      deploy = { adapter: asString(table.adapter, `environments.${name}.deploy.adapter`), config };
    }
    environments.push({
      name,
      config: asString(record.config, `environments.${name}.config`),
      clientId: record.client_id === void 0 ? void 0 : asString(record.client_id, `environments.${name}.client_id`),
      store: record.store === void 0 ? void 0 : asString(record.store, `environments.${name}.store`),
      url: record.url === void 0 ? void 0 : asString(record.url, `environments.${name}.url`),
      protected: record.protected === true,
      deploy,
      env
    });
  }
  if (environments.length === 0) fail("environments", "must declare at least one environment");
  return {
    root,
    playground: raw.playground === void 0 ? void 0 : asString(raw.playground, "playground"),
    tiers,
    environments
  };
}
function readTiers(manifest) {
  const values = /* @__PURE__ */ new Map();
  for (const tier of manifest.tiers) {
    const path = (0, import_node_path.join)(manifest.root, tier);
    if (!(0, import_node_fs.existsSync)(path)) continue;
    for (const line of (0, import_node_fs.readFileSync)(path, "utf8").split("\n")) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (match === null) continue;
      const [, key, rawValue] = match;
      if (key === void 0 || rawValue === void 0 || values.has(key)) continue;
      values.set(key, rawValue.replace(/^"(.*)"$/, "$1"));
    }
  }
  return values;
}
function resolveEnv(environment, tiers) {
  const entries = [];
  const missing = [];
  for (const [name, value] of Object.entries(environment.env)) {
    if (value.startsWith("@")) {
      const key = value.slice(1);
      const resolved = tiers.get(key) ?? "";
      if (resolved === "") missing.push(`${name} (@${key})`);
      entries.push({ name, value: resolved, fromTier: true });
    } else {
      entries.push({ name, value, fromTier: false });
    }
  }
  return { entries, missing };
}
function configClientId(root, configFile) {
  const path = (0, import_node_path.join)(root, configFile);
  if (!(0, import_node_fs.existsSync)(path)) return void 0;
  const match = /^client_id\s*=\s*"([^"]+)"/m.exec((0, import_node_fs.readFileSync)(path, "utf8"));
  return match?.[1];
}
function configDevStore(root, configFile) {
  const path = (0, import_node_path.join)(root, configFile);
  if (!(0, import_node_fs.existsSync)(path)) return void 0;
  const match = /^dev_store_url\s*=\s*"([^"]+)"/m.exec((0, import_node_fs.readFileSync)(path, "utf8"));
  return match?.[1];
}

// src/commands/envs/status.ts
var EnvsStatus = class extends import_core.Command {
  static description = "Show every environment: config, store, tier completeness, deploy-target state, drift.";
  async run() {
    const root = process.cwd();
    if (!hasManifest(root)) this.error(`no ${MANIFEST_FILE} in ${root}`);
    const manifest = loadManifest(root);
    const tiers = readTiers(manifest);
    for (const environment of manifest.environments) {
      this.log(`${environment.name}${environment.protected ? "  [protected]" : ""}`);
      const configPath = (0, import_node_path2.join)(root, environment.config);
      if (!(0, import_node_fs2.existsSync)(configPath)) {
        this.log(`  config   : ${environment.config} MISSING (link it with: shopify app config link --client-id <id>)`);
      } else {
        const clientId = configClientId(root, environment.config);
        const drift = environment.clientId !== void 0 && environment.clientId !== "" && clientId !== environment.clientId ? `  DRIFT: manifest says ${environment.clientId}` : "";
        this.log(`  config   : ${environment.config} (client_id ${clientId ?? "unreadable"})${drift}`);
      }
      if (environment.store === void 0 || environment.store === "") {
        const hint = manifest.playground === void 0 ? "" : ` \u2014 for an install/boot smoke test, send the install link to the org playground: ${manifest.playground}`;
        this.log(`  store    : none configured${hint}`);
      } else {
        const tomlStore = configDevStore(root, environment.config);
        const drift = tomlStore !== void 0 && tomlStore !== environment.store ? `  DRIFT: ${environment.config} names ${tomlStore}` : "";
        this.log(`  store    : ${environment.store}${drift}`);
      }
      if (environment.url !== void 0) this.log(`  url      : ${environment.url}`);
      const resolved = resolveEnv(environment, tiers);
      if (resolved.entries.length > 0) {
        const missing = resolved.missing.length === 0 ? "" : `  MISSING: ${resolved.missing.join(", ")}`;
        this.log(
          `  env      : ${resolved.entries.length - resolved.missing.length}/${resolved.entries.length} resolved${missing}`
        );
      }
      if (environment.deploy !== void 0) {
        try {
          const { adapter, config, missing } = resolveDeployConfig(environment, tiers);
          if (missing.length > 0) {
            this.log(`  deploy   : ${adapter.name}, config unresolved: ${missing.join(", ")}`);
          } else {
            const state = await adapter.create(config).status().catch((error) => `unreachable (${error instanceof Error ? error.message : String(error)})`);
            this.log(`  deploy   : ${adapter.name} \u2014 ${state}`);
          }
        } catch (error) {
          this.log(`  deploy   : ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
};
/*! Bundled license information:

smol-toml/dist/date.js:
smol-toml/dist/error.js:
smol-toml/dist/util.js:
smol-toml/dist/primitive.js:
smol-toml/dist/extract.js:
smol-toml/dist/struct.js:
smol-toml/dist/parse.js:
smol-toml/dist/stringify.js:
smol-toml/dist/index.js:
  (*!
   * Copyright (c) Squirrel Chat et al., All rights reserved.
   * SPDX-License-Identifier: BSD-3-Clause
   *
   * Redistribution and use in source and binary forms, with or without
   * modification, are permitted provided that the following conditions are met:
   *
   * 1. Redistributions of source code must retain the above copyright notice, this
   *    list of conditions and the following disclaimer.
   * 2. Redistributions in binary form must reproduce the above copyright notice,
   *    this list of conditions and the following disclaimer in the
   *    documentation and/or other materials provided with the distribution.
   * 3. Neither the name of the copyright holder nor the names of its contributors
   *    may be used to endorse or promote products derived from this software without
   *    specific prior written permission.
   *
   * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
   * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
   * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
   * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
   * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
   * CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
   * OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
   * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
   *)
*/
