import { build } from "esbuild";

const shared = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  logLevel: "warning",
  external: ["@oclif/core"],
};

const entries = [
  ["src/commands/envs/status.ts", "dist/commands/envs/status.js"],
  ["src/commands/envs/use.ts", "dist/commands/envs/use.js"],
  ["src/commands/envs/push.ts", "dist/commands/envs/push.js"],
  ["src/commands/envs/deploy.ts", "dist/commands/envs/deploy.js"],
  ["src/commands/envs/doctor.ts", "dist/commands/envs/doctor.js"],
  ["src/hooks/init.ts", "dist/hooks/init.js"],
];

for (const [entry, outfile] of entries) {
  await build({ ...shared, entryPoints: [entry], outfile });
}
