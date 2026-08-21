import { existsSync } from "node:fs";
import { join } from "node:path";

import { Command } from "@oclif/core";

import { resolveDeployConfig } from "../../lib/adapters";
import { configClientId, hasManifest, loadManifest, MANIFEST_FILE, readTiers, resolveEnv } from "../../lib/manifest";

export default class EnvsDoctor extends Command {
  static description = "Check the manifest, configs, tiers, deploy targets, and guard coverage. Exits non-zero on any failure.";

  async run(): Promise<void> {
    const root = process.cwd();
    if (!hasManifest(root)) this.error(`no ${MANIFEST_FILE} in ${root}`);

    let failures = 0;
    const report = (ok: boolean, message: string) => {
      this.log(`${ok ? "ok  " : "FAIL"}  ${message}`);
      if (!ok) failures += 1;
    };

    let manifest;
    try {
      manifest = loadManifest(root);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }
    report(true, `${MANIFEST_FILE} parses (${manifest.environments.length} environments)`);

    const tiers = readTiers(manifest);
    report(tiers.size > 0, `tiers readable (${tiers.size} keys across ${manifest.tiers.length} files)`);

    for (const environment of manifest.environments) {
      const prefix = `${environment.name}:`;
      const configPath = join(root, environment.config);
      const configExists = existsSync(configPath);
      report(configExists, `${prefix} config ${environment.config} ${configExists ? "exists" : "missing"}`);

      if (configExists && environment.clientId !== undefined && environment.clientId !== "") {
        const actual = configClientId(root, environment.config);
        report(actual === environment.clientId, `${prefix} client_id matches (${actual ?? "unreadable"})`);
      }
      if (environment.protected) {
        const guarded = environment.clientId !== undefined && environment.clientId !== "";
        report(
          guarded,
          `${prefix} protected and ${guarded ? "guarded by client_id" : `UNGUARDED — set client_id in ${MANIFEST_FILE}`}`,
        );
      }

      const resolved = resolveEnv(environment, tiers);
      if (resolved.entries.length > 0) {
        report(
          resolved.missing.length === 0,
          `${prefix} env mapping resolves (${resolved.entries.length - resolved.missing.length}/${resolved.entries.length}${resolved.missing.length === 0 ? "" : `; missing ${resolved.missing.join(", ")}`})`,
        );
      }
      if (environment.deploy !== undefined) {
        try {
          const { adapter, missing } = resolveDeployConfig(environment, tiers);
          report(
            missing.length === 0,
            `${prefix} deploy adapter ${adapter.name} ${missing.length === 0 ? "configured" : `unresolved: ${missing.join(", ")}`}`,
          );
        } catch (error) {
          report(false, `${prefix} ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    report(true, `playground store ${manifest.playground ?? "not set (optional)"}`);

    if (failures > 0) this.error(`${failures} check(s) failed`);
    this.log("all checks passed");
  }
}
