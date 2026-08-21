import { Args, Command, Flags } from "@oclif/core";

import { findEnvironment, hasManifest, loadManifest, MANIFEST_FILE } from "../../lib/manifest";
import { planPush } from "../../lib/push";

export default class EnvsDeploy extends Command {
  static description = "Push an environment's variables, trigger its deployment, and wait for the result.";

  static args = {
    environment: Args.string({ description: "environment name from envs.toml", required: true }),
  };

  static flags = {
    "skip-push": Flags.boolean({ description: "deploy without replacing the environment variables first" }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(EnvsDeploy);
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

    if (flags["skip-push"]) {
      this.log(`skipping env push; deploying ${plan.target.describe()} as-is`);
    } else {
      await plan.target.pushEnv(plan.blob);
      this.log(`env saved (${plan.names.length} variables)`);
    }

    this.log("deployment triggered, waiting...");
    const outcome = await plan.target.deploy(`shopify envs deploy ${environment.name}`);
    if (!outcome.ok) this.error(outcome.detail);
    this.log(outcome.detail);
    if (environment.url !== undefined) this.log(`serving: ${environment.url}`);
  }
}
