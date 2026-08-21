export interface DeployOutcome {
  ok: boolean;
  detail: string;
}

export interface DeployTarget {
  describe(): string;
  status(): Promise<string>;
  pushEnv(blob: string): Promise<void>;
  deploy(title: string): Promise<DeployOutcome>;
}

export interface Adapter {
  name: string;
  requiredConfig: string[];
  create(config: Record<string, string>): DeployTarget;
}
