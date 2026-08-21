import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

export interface DeployConfig {
  adapter: string;
  config: Record<string, string>;
}

export interface Environment {
  name: string;
  config: string;
  clientId?: string;
  store?: string;
  url?: string;
  protected: boolean;
  deploy?: DeployConfig;
  env: Record<string, string>;
}

export interface Manifest {
  root: string;
  playground?: string;
  tiers: string[];
  environments: Environment[];
}

export const MANIFEST_FILE = "envs.toml";

export function manifestPath(root: string): string {
  return join(root, MANIFEST_FILE);
}

export function hasManifest(root: string): boolean {
  return existsSync(manifestPath(root));
}

function fail(field: string, problem: string): never {
  throw new Error(`${MANIFEST_FILE}: ${field} ${problem}`);
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") fail(field, "must be a string");
  return value;
}

const ENVIRONMENT_KEYS = new Set([
  "config",
  "client_id",
  "store",
  "url",
  "protected",
  "deploy",
  "env",
]);

export function loadManifest(root: string): Manifest {
  const path = manifestPath(root);
  if (!existsSync(path)) fail("file", `not found at ${path}`);

  let raw: Record<string, unknown>;
  try {
    raw = parseToml(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (error) {
    fail("file", `does not parse as TOML: ${error instanceof Error ? error.message : String(error)}`);
  }

  const tiers = Array.isArray(raw.tiers) ? raw.tiers.map((t) => asString(t, "tiers[]")) : [];
  if (tiers.length === 0) fail("tiers", "must list at least one tier file");

  const envTable = raw.environments;
  if (typeof envTable !== "object" || envTable === null) {
    fail("environments", "must be a table with one entry per environment");
  }

  const environments: Environment[] = [];
  for (const [name, entry] of Object.entries(envTable as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) fail(`environments.${name}`, "must be a table");
    const record = entry as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!ENVIRONMENT_KEYS.has(key)) fail(`environments.${name}.${key}`, "is not a recognized field");
    }
    if (record.config === undefined) fail(`environments.${name}.config`, "is required");

    const env: Record<string, string> = {};
    if (record.env !== undefined) {
      if (typeof record.env !== "object" || record.env === null) fail(`environments.${name}.env`, "must be a table");
      for (const [key, value] of Object.entries(record.env as Record<string, unknown>)) {
        env[key] = asString(value, `environments.${name}.env.${key}`);
      }
    }

    let deploy: DeployConfig | undefined;
    if (record.deploy !== undefined) {
      if (typeof record.deploy !== "object" || record.deploy === null) {
        fail(`environments.${name}.deploy`, "must be a table");
      }
      const table = record.deploy as Record<string, unknown>;
      if (table.adapter === undefined) fail(`environments.${name}.deploy.adapter`, "is required");
      const config: Record<string, string> = {};
      for (const [key, value] of Object.entries(table)) {
        if (key === "adapter") continue;
        config[key] = asString(value, `environments.${name}.deploy.${key}`);
      }
      deploy = { adapter: asString(table.adapter, `environments.${name}.deploy.adapter`), config };
    }

    environments.push({
      name,
      config: asString(record.config, `environments.${name}.config`),
      clientId: record.client_id === undefined ? undefined : asString(record.client_id, `environments.${name}.client_id`),
      store: record.store === undefined ? undefined : asString(record.store, `environments.${name}.store`),
      url: record.url === undefined ? undefined : asString(record.url, `environments.${name}.url`),
      protected: record.protected === true,
      deploy,
      env,
    });
  }
  if (environments.length === 0) fail("environments", "must declare at least one environment");

  return {
    root,
    playground: raw.playground === undefined ? undefined : asString(raw.playground, "playground"),
    tiers,
    environments,
  };
}

export function readTiers(manifest: Manifest): Map<string, string> {
  const values = new Map<string, string>();
  for (const tier of manifest.tiers) {
    const path = join(manifest.root, tier);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (match === null) continue;
      const [, key, rawValue] = match;
      if (key === undefined || rawValue === undefined || values.has(key)) continue;
      values.set(key, rawValue.replace(/^"(.*)"$/, "$1"));
    }
  }
  return values;
}

export interface ResolvedEnv {
  entries: Array<{ name: string; value: string; fromTier: boolean }>;
  missing: string[];
}

export function resolveEnv(environment: Environment, tiers: Map<string, string>): ResolvedEnv {
  const entries: ResolvedEnv["entries"] = [];
  const missing: string[] = [];
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

export function findEnvironment(manifest: Manifest, name: string): Environment {
  const environment = manifest.environments.find((entry) => entry.name === name);
  if (environment === undefined) {
    const known = manifest.environments.map((entry) => entry.name).join(", ");
    throw new Error(`unknown environment "${name}"; ${MANIFEST_FILE} declares: ${known}`);
  }
  return environment;
}

export function configClientId(root: string, configFile: string): string | undefined {
  const path = join(root, configFile);
  if (!existsSync(path)) return undefined;
  const match = /^client_id\s*=\s*"([^"]+)"/m.exec(readFileSync(path, "utf8"));
  return match?.[1];
}

export function configDevStore(root: string, configFile: string): string | undefined {
  const path = join(root, configFile);
  if (!existsSync(path)) return undefined;
  const match = /^dev_store_url\s*=\s*"([^"]+)"/m.exec(readFileSync(path, "utf8"));
  return match?.[1];
}
