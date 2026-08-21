import { httpsRequest } from "../net";
import type { Adapter, DeployOutcome, DeployTarget } from "./types";

function baseUrl(): string {
  return (process.env.DOKPLOY_URL ?? "https://app.dokploy.com").replace(/\/$/, "");
}

function apiKey(): string {
  const key = process.env.DOKPLOY_API_KEY ?? "";
  if (key === "") throw new Error("DOKPLOY_API_KEY is unset");
  return key;
}

async function get<T>(path: string): Promise<T> {
  const response = await httpsRequest(`${baseUrl()}/api/${path}`, { headers: { "x-api-key": apiKey() } });
  if (response.status !== 200) {
    throw new Error(`GET ${path} answered ${response.status}: ${response.body.slice(0, 200)}`);
  }
  return JSON.parse(response.body) as T;
}

async function post(path: string, payload: unknown): Promise<void> {
  const response = await httpsRequest(`${baseUrl()}/api/${path}`, {
    method: "POST",
    headers: { "x-api-key": apiKey(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status !== 200) {
    throw new Error(`POST ${path} answered ${response.status}: ${response.body.slice(0, 300)}`);
  }
}

interface Application {
  applicationId: string;
  name: string;
  applicationStatus: string;
  buildArgs: string | null;
  buildSecrets: string | null;
  createEnvFile: boolean | null;
}

interface Deployment {
  deploymentId: string;
  status: string;
  createdAt: string;
}

const POLL_MS = 10_000;
const TIMEOUT_MS = 15 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class DokployTarget implements DeployTarget {
  constructor(private readonly appId: string) {}

  describe(): string {
    return `dokploy application ${this.appId}`;
  }

  async status(): Promise<string> {
    if ((process.env.DOKPLOY_API_KEY ?? "") === "") return `${this.appId} (DOKPLOY_API_KEY unset, status unknown)`;
    const app = await get<Application>(`application.one?applicationId=${encodeURIComponent(this.appId)}`);
    return `${app.name} — ${app.applicationStatus}`;
  }

  async pushEnv(blob: string): Promise<void> {
    const app = await get<Application>(`application.one?applicationId=${encodeURIComponent(this.appId)}`);
    await post("application.saveEnvironment", {
      applicationId: app.applicationId,
      env: blob,
      buildArgs: app.buildArgs ?? null,
      buildSecrets: app.buildSecrets ?? null,
      createEnvFile: app.createEnvFile ?? true,
    });
  }

  async deploy(title: string): Promise<DeployOutcome> {
    const list = () => get<Deployment[]>(`deployment.all?applicationId=${encodeURIComponent(this.appId)}`);
    const known = new Set((await list()).map((deployment) => deployment.deploymentId));
    await post("application.deploy", { applicationId: this.appId, title });

    const startedAt = Date.now();
    for (;;) {
      if (Date.now() - startedAt > TIMEOUT_MS) return { ok: false, detail: "timed out waiting for the deployment" };
      await sleep(POLL_MS);
      const fresh = (await list())
        .filter((deployment) => !known.has(deployment.deploymentId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (fresh === undefined || fresh.status === "running") continue;
      if (fresh.status === "done") return { ok: true, detail: `deployment ${fresh.deploymentId} done` };
      const logs = await get<{ data?: string } | string>(
        `deployment.readLogs?deploymentId=${encodeURIComponent(fresh.deploymentId)}&tail=40`,
      ).catch(() => "(logs unavailable)");
      const text = typeof logs === "string" ? logs : (logs.data ?? "");
      return { ok: false, detail: `deployment ${fresh.deploymentId} ended ${fresh.status}\n${text}` };
    }
  }
}

export const dokployAdapter: Adapter = {
  name: "dokploy",
  requiredConfig: ["app_id"],
  create(config) {
    const appId = config.app_id ?? "";
    if (appId === "") throw new Error("dokploy adapter needs app_id");
    return new DokployTarget(appId);
  },
};
