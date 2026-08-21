import type { Environment } from "../manifest";
import { dokployAdapter } from "./dokploy";
import type { Adapter, DeployTarget } from "./types";

const ADAPTERS: Adapter[] = [dokployAdapter];

export function adapterNames(): string[] {
  return ADAPTERS.map((adapter) => adapter.name);
}

export function findAdapter(name: string): Adapter {
  const adapter = ADAPTERS.find((entry) => entry.name === name);
  if (adapter === undefined) {
    throw new Error(`unknown deploy adapter "${name}"; available: ${adapterNames().join(", ")}`);
  }
  return adapter;
}

export function resolveDeployConfig(
  environment: Environment,
  tiers: Map<string, string>,
): { adapter: Adapter; config: Record<string, string>; missing: string[] } {
  if (environment.deploy === undefined) {
    throw new Error(`environment "${environment.name}" declares no [environments.${environment.name}.deploy] table`);
  }
  const adapter = findAdapter(environment.deploy.adapter);
  const config: Record<string, string> = {};
  const missing: string[] = [];
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

export function deployTargetFor(environment: Environment, tiers: Map<string, string>): DeployTarget {
  const { adapter, config, missing } = resolveDeployConfig(environment, tiers);
  if (missing.length > 0) {
    throw new Error(`deploy config unresolved for ${environment.name}: ${missing.join(", ")}`);
  }
  return adapter.create(config);
}
