import { existsSync } from "node:fs";
import { join } from "node:path";

import { Command } from "@oclif/core";

import { resolveDeployConfig } from "../../lib/adapters";
import {
  configClientId,
  configDevStore,
  hasManifest,
  loadManifest,
  MANIFEST_FILE,
  readTiers,
  resolveEnv,
} from "../../lib/manifest";

export default class EnvsStatus extends Command {
  static description = "Show every environment: config, store, tier completeness, deploy-target state, drift.";

  async run(): Promise<void> {
    const root = process.cwd();
    if (!hasManifest(root)) this.error(`no ${MANIFEST_FILE} in ${root}`);
    const manifest = loadManifest(root);
    const tiers = readTiers(manifest);

    for (const environment of manifest.environments) {
      this.log(`${environment.name}${environment.protected ? "  [protected]" : ""}`);

      const configPath = join(root, environment.config);
      if (!existsSync(configPath)) {
        this.log(`  config   : ${environment.config} MISSING (link it with: shopify app config link --client-id <id>)`);
      } else {
        const clientId = configClientId(root, environment.config);
        const drift =
          environment.clientId !== undefined && environment.clientId !== "" && clientId !== environment.clientId
            ? `  DRIFT: manifest says ${environment.clientId}`
            : "";
        this.log(`  config   : ${environment.config} (client_id ${clientId ?? "unreadable"})${drift}`);
      }

      if (environment.store === undefined || environment.store === "") {
        const hint =
          manifest.playground === undefined
            ? ""
            : ` — for an install/boot smoke test, send the install link to the org playground: ${manifest.playground}`;
        this.log(`  store    : none configured${hint}`);
      } else {
        const tomlStore = configDevStore(root, environment.config);
        const drift =
          tomlStore !== undefined && tomlStore !== environment.store
            ? `  DRIFT: ${environment.config} names ${tomlStore}`
            : "";
        this.log(`  store    : ${environment.store}${drift}`);
      }

      if (environment.url !== undefined) this.log(`  url      : ${environment.url}`);

      const resolved = resolveEnv(environment, tiers);
      if (resolved.entries.length > 0) {
        const missing = resolved.missing.length === 0 ? "" : `  MISSING: ${resolved.missing.join(", ")}`;
        this.log(
          `  env      : ${resolved.entries.length - resolved.missing.length}/${resolved.entries.length} resolved${missing}`,
        );
      }

      if (environment.deploy !== undefined) {
        try {
          const { adapter, config, missing } = resolveDeployConfig(environment, tiers);
          if (missing.length > 0) {
            this.log(`  deploy   : ${adapter.name}, config unresolved: ${missing.join(", ")}`);
          } else {
            const state = await adapter
              .create(config)
              .status()
              .catch((error: unknown) => `unreachable (${error instanceof Error ? error.message : String(error)})`);
            this.log(`  deploy   : ${adapter.name} — ${state}`);
          }
        } catch (error) {
          this.log(`  deploy   : ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
}
