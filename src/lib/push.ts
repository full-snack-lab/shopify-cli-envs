import type { Environment, Manifest } from "./manifest";
import { readTiers, resolveEnv } from "./manifest";
import { deployTargetFor } from "./adapters";
import type { DeployTarget } from "./adapters/types";

export interface PushPlan {
  target: DeployTarget;
  names: string[];
  blob: string;
}

export function planPush(manifest: Manifest, environment: Environment): PushPlan {
  if (Object.keys(environment.env).length === 0) {
    throw new Error(`environment "${environment.name}" declares no [environments.${environment.name}.env] mapping`);
  }
  const tiers = readTiers(manifest);
  const target = deployTargetFor(environment, tiers);

  const resolved = resolveEnv(environment, tiers);
  if (resolved.missing.length > 0) {
    throw new Error(`refusing to push, these resolved empty: ${resolved.missing.join(", ")}`);
  }
  return {
    target,
    names: resolved.entries.map((entry) => entry.name),
    blob: resolved.entries.map((entry) => `${entry.name}=${entry.value}`).join("\n") + "\n",
  };
}
