import { Args, Command, Flags } from "@oclif/core";

import { findEnvironment, hasManifest, loadManifest, MANIFEST_FILE } from "../../lib/manifest";
import { planPush } from "../../lib/push";

export default class EnvsPush extends Command {
  static description = "Replace an environment's deploy-target variables from the tier files. Values never print.";

  static args = {
    environment: Args.string({ description: "environment name from envs.toml", required: true }),
  };

  static flags = {
    "dry-run": Flags.boolean({ description: "list what would be sent, send nothing" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EnvsPush);
    const root = process.cwd();
    if (!hasManifest(root)) this.error(`no ${MANIFEST_FILE} in ${root}`);
    const manifest = loadManifest(root);
    const environment = findEnvironment(manifest, args.environment);

    let plan;
    try {
      plan = planPush(manifest, environment);
    } catch (error) {
      this.error(error instanceof Error ? error.message : String(error));
    }

    this.log(`environment : ${environment.name}`);
    this.log(`target      : ${plan.target.describe()}`);
    this.log(`variables   : ${plan.names.length}`);
    for (const name of plan.names) this.log(`  ${name}`);

    if (flags["dry-run"]) {
      this.log("(dry run, nothing sent)");
      return;
    }

    await plan.target.pushEnv(plan.blob);
    this.log(`saved. Redeploy for it to take effect (shopify envs deploy ${environment.name}).`);
  }
}
