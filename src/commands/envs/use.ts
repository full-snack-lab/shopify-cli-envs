import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { Args, Command } from "@oclif/core";

import { configDevStore, findEnvironment, hasManifest, loadManifest, MANIFEST_FILE, readTiers, resolveEnv } from "../../lib/manifest";

export default class EnvsUse extends Command {
  static description = "Activate an environment's app configuration, after validating its manifest entry and tier.";

  static args = {
    environment: Args.string({ description: "environment name from envs.toml", required: true }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(EnvsUse);
    const root = process.cwd();
    if (!hasManifest(root)) this.error(`no ${MANIFEST_FILE} in ${root}`);
    const manifest = loadManifest(root);
    const environment = findEnvironment(manifest, args.environment);

    if (!existsSync(join(root, environment.config))) {
      this.error(
        `${environment.config} does not exist. Link it first: shopify app config link --client-id <${environment.name} client id>`,
      );
    }

    const resolved = resolveEnv(environment, readTiers(manifest));
    if (resolved.missing.length > 0) {
      this.warn(`tier keys unresolved for ${environment.name}: ${resolved.missing.join(", ")}`);
    }

    const result = spawnSync("shopify", ["app", "config", "use", environment.config], {
      stdio: "inherit",
      env: process.env,
    });
    if (result.status !== 0) this.exit(result.status ?? 1);

    const tomlStore = configDevStore(root, environment.config);
    if (environment.store !== undefined && tomlStore !== undefined && tomlStore !== environment.store) {
      this.warn(`${environment.config} dev_store_url is ${tomlStore}; ${MANIFEST_FILE} says ${environment.store}`);
    }
    this.log(`${environment.name} active (${environment.config})`);
  }
}
