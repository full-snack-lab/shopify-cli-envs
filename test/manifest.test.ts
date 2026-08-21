import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadManifest, readTiers, resolveEnv, findEnvironment, configClientId } from "../src/lib/manifest";
import { planPush } from "../src/lib/push";
import { activeConfigFile, protectedEnvironmentFor } from "../src/hooks/init";

const MANIFEST = `
playground = "playground.myshopify.com"
tiers = [".env.a.local", ".env.b.local"]

[environments.dev]
config = "shopify.app.toml"
client_id = "dev-id"
store = "dev.myshopify.com"

[environments.staging]
config = "shopify.app.staging.toml"
client_id = "staging-id"
url = "https://staging.example.com"
protected = true

[environments.staging.deploy]
adapter = "dokploy"
app_id = "@STAGING_APP_ID"

[environments.staging.env]
NODE_ENV = "production"
SHOPIFY_API_KEY = "@STAGING_CLIENT_ID"
SECRET = "@STAGING_SECRET"
`;

function fixture(overrides: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "envs-"));
  writeFileSync(join(root, "envs.toml"), overrides["envs.toml"] ?? MANIFEST);
  writeFileSync(join(root, ".env.a.local"), overrides[".env.a.local"] ?? 'STAGING_APP_ID=app-123\nSTAGING_CLIENT_ID=staging-id\n');
  writeFileSync(join(root, ".env.b.local"), overrides[".env.b.local"] ?? 'STAGING_SECRET="shh"\n');
  writeFileSync(join(root, "shopify.app.toml"), overrides["shopify.app.toml"] ?? 'client_id = "dev-id"\n[build]\ndev_store_url = "dev.myshopify.com"\n');
  return root;
}

describe("loadManifest", () => {
  it("parses environments with their fields", () => {
    const manifest = loadManifest(fixture());
    expect(manifest.playground).toBe("playground.myshopify.com");
    expect(manifest.environments.map((entry) => entry.name)).toEqual(["dev", "staging"]);
    const staging = findEnvironment(manifest, "staging");
    expect(staging.protected).toBe(true);
    expect(staging.deploy?.adapter).toBe("dokploy");
    expect(staging.deploy?.config.app_id).toBe("@STAGING_APP_ID");
  });

  it("rejects unknown environment fields", () => {
    const bad = MANIFEST.replace('store = "dev.myshopify.com"', 'stor = "dev.myshopify.com"');
    expect(() => loadManifest(fixture({ "envs.toml": bad }))).toThrow(/environments\.dev\.stor/);
  });

  it("rejects a manifest without tiers", () => {
    const bad = MANIFEST.replace('tiers = [".env.a.local", ".env.b.local"]', "tiers = []");
    expect(() => loadManifest(fixture({ "envs.toml": bad }))).toThrow(/tiers/);
  });

  it("names unknown environments with the known list", () => {
    const manifest = loadManifest(fixture());
    expect(() => findEnvironment(manifest, "prod")).toThrow(/declares: dev, staging/);
  });
});

describe("tiers and env resolution", () => {
  it("reads tiers first-value-wins and strips quotes", () => {
    const root = fixture({ ".env.b.local": 'STAGING_SECRET="shh"\nSTAGING_APP_ID=ignored\n' });
    const tiers = readTiers(loadManifest(root));
    expect(tiers.get("STAGING_SECRET")).toBe("shh");
    expect(tiers.get("STAGING_APP_ID")).toBe("app-123");
  });

  it("resolves @refs and reports missing ones", () => {
    const root = fixture({ ".env.b.local": "\n" });
    const manifest = loadManifest(root);
    const resolved = resolveEnv(findEnvironment(manifest, "staging"), readTiers(manifest));
    expect(resolved.missing).toEqual(["SECRET (@STAGING_SECRET)"]);
  });
});

describe("planPush", () => {
  it("builds the blob with literals and tier values", () => {
    const manifest = loadManifest(fixture());
    const plan = planPush(manifest, findEnvironment(manifest, "staging"));
    expect(plan.target.describe()).toBe("dokploy application app-123");
    expect(plan.names).toEqual(["NODE_ENV", "SHOPIFY_API_KEY", "SECRET"]);
    expect(plan.blob).toBe("NODE_ENV=production\nSHOPIFY_API_KEY=staging-id\nSECRET=shh\n");
  });

  it("refuses when a ref is empty", () => {
    const manifest = loadManifest(fixture({ ".env.b.local": "\n" }));
    expect(() => planPush(manifest, findEnvironment(manifest, "staging"))).toThrow(/resolved empty/);
  });

  it("refuses environments with no deploy table", () => {
    const manifest = loadManifest(fixture());
    expect(() => planPush(manifest, findEnvironment(manifest, "dev"))).toThrow(/env\] mapping|deploy\] table/);
  });

  it("refuses when the adapter is unknown", () => {
    const bad = MANIFEST.replace('adapter = "dokploy"', 'adapter = "flyio"');
    const manifest = loadManifest(fixture({ "envs.toml": bad }));
    expect(() => planPush(manifest, findEnvironment(manifest, "staging"))).toThrow(/unknown deploy adapter "flyio"/);
  });
});

describe("guard", () => {
  it("resolves the active config from --config flag forms", () => {
    expect(activeConfigFile("/nope", ["--config", "staging"])).toBe("shopify.app.staging.toml");
    expect(activeConfigFile("/nope", ["--config=shopify.app.staging.toml"])).toBe("shopify.app.staging.toml");
    expect(activeConfigFile("/nope", [])).toBe("shopify.app.toml");
  });

  it("does not protect the dev config", () => {
    const root = fixture();
    expect(protectedEnvironmentFor(root, [])).toBeUndefined();
  });

  it("protects a config whose client id maps to a protected environment", () => {
    const root = fixture({ "shopify.app.toml": 'client_id = "staging-id"\n' });
    expect(protectedEnvironmentFor(root, [])).toBe("staging");
  });

  it("reads client ids from tomls", () => {
    const root = fixture();
    expect(configClientId(root, "shopify.app.toml")).toBe("dev-id");
  });
});

describe("cached config detection", () => {
  it("reads the CLI's per-directory config cache", () => {
    const root = fixture({ "shopify.app.toml": 'client_id = "dev-id"\n' });
    const xdg = mkdtempSync(join(tmpdir(), "xdg-"));
    const dir = join(xdg, "shopify-cli-app-nodejs");
    require("node:fs").mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify({ [root]: { configFile: "shopify.app.staging.toml" } }));
    const previous = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdg;
    try {
      expect(activeConfigFile(root, [])).toBe("shopify.app.staging.toml");
      expect(activeConfigFile(root, ["--config", "dev"])).toBe("shopify.app.dev.toml");
    } finally {
      if (previous === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previous;
    }
  });
});
