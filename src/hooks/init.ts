import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { configClientId, hasManifest, loadManifest } from "../lib/manifest";

interface InitOptions {
  id?: string;
  argv?: string[];
}

function cachedConfigFile(root: string): string | undefined {
  const base = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  const cachePath = join(base, "shopify-cli-app-nodejs", "config.json");
  if (!existsSync(cachePath)) return undefined;
  try {
    const cache = JSON.parse(readFileSync(cachePath, "utf8")) as Record<string, { configFile?: string }>;
    const entry = cache[root];
    return typeof entry?.configFile === "string" ? entry.configFile : undefined;
  } catch {
    return undefined;
  }
}

export function activeConfigFile(root: string, argv: string[]): string {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--config" || arg === "-c") {
      const value = argv[index + 1];
      if (value !== undefined) return value.endsWith(".toml") ? value : `shopify.app.${value}.toml`;
    }
    if (arg !== undefined && arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      return value.endsWith(".toml") ? value : `shopify.app.${value}.toml`;
    }
  }

  const cached = cachedConfigFile(root);
  if (cached !== undefined) return cached;

  const statePath = join(root, ".shopify", "project.json");
  if (existsSync(statePath)) {
    try {
      const state = readFileSync(statePath, "utf8");
      const match = /"(shopify\.app[^"]*\.toml)"/.exec(state);
      if (match?.[1] !== undefined) return match[1];
    } catch {
      return "shopify.app.toml";
    }
  }
  return "shopify.app.toml";
}

export function protectedEnvironmentFor(root: string, argv: string[]): string | undefined {
  const manifest = loadManifest(root);
  const config = activeConfigFile(root, argv);
  const clientId = configClientId(root, config);
  if (clientId === undefined) return undefined;
  const environment = manifest.environments.find(
    (entry) => entry.protected && entry.clientId !== undefined && entry.clientId === clientId,
  );
  return environment?.name;
}

const hook = async function (options: InitOptions): Promise<void> {
  try {
    if (options.id !== "app:dev") return;
    if (process.env.SHOPIFY_ENVS_UNGUARD === "1") return;
    const root = process.cwd();
    if (!hasManifest(root)) return;

    const environment = protectedEnvironmentFor(root, options.argv ?? []);
    if (environment === undefined) return;

    process.stderr.write(
      `shopify-cli-envs: refusing to run app dev against the "${environment}" environment — its app config is protected, and dev would rewrite that app's URLs to a local tunnel.\n` +
        `Switch first (shopify envs use dev) or override deliberately with SHOPIFY_ENVS_UNGUARD=1.\n`,
    );
    process.exit(1);
  } catch {
    return;
  }
};

export default hook;
