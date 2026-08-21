# shopify-cli-envs

A Shopify CLI plugin that manages app environments — dev / staging /
production — from one committed manifest. Config switching, deploy-target env
push, deploys with result polling, drift detection, and a guard that stops
`shopify app dev` from ever touching a protected environment's app.

```bash
shopify plugins install full-snack-lab/shopify-cli-envs   # from GitHub
```

## The problem

A Shopify app that ships through dev, staging, and production accumulates
`shopify.app.*.toml` files, tiered `.env.*.local` secret files, hosting-side
environment variables, and a set of unwritten rules about which app belongs to
which rung. Two failure modes follow: `shopify app dev` run against the wrong
config rewrites a deployed app's URLs to an ephemeral tunnel, and hand-carried
env pushes drift from the tiers. This plugin makes the environment map a
committed fact and the failure modes machine-checked.

## envs.toml

One non-secret manifest at the repo root:

```toml
playground = "yourorg.myshopify.com"
tiers = [".env.dev.local", ".env.staging.local", ".env.production.local", ".env.ops.local"]

[environments.dev]
config = "shopify.app.toml"
client_id = "<dev app client id>"
store = "your-dev-store.myshopify.com"

[environments.staging]
config = "shopify.app.staging.toml"
client_id = "<staging app client id>"
store = "your-staging-store.myshopify.com"
url = "https://staging.example.com"
protected = true

[environments.staging.deploy]
adapter = "dokploy"
app_id = "@STAGING_DOKPLOY_APP_ID"

[environments.staging.env]
NODE_ENV = "production"
SHOPIFY_API_KEY = "@STAGING_SHOPIFY_CLIENT_ID"
SHOPIFY_API_SECRET = "@STAGING_SHOPIFY_CLIENT_SECRET"
SHOPIFY_APP_URL = "@STAGING_APP_URL"
DATABASE_URL = "@STAGING_DB_URL"
```

`@KEY` values resolve from the tier files at command time. Secrets stay in the
gitignored tiers; the manifest and this plugin never hold one, and command
output prints variable names only, never values.

## Commands

- `shopify envs status` — every environment: config file and its client id,
  store, tier resolution, deploy-target state, and any drift between manifest
  and reality.
- `shopify envs use <env>` — validates the environment, then runs
  `shopify app config use` on its config.
- `shopify envs push <env> [--dry-run]` — full-replace the deploy target's
  variables from the tiers. Refuses if any reference resolves empty.
- `shopify envs deploy <env> [--skip-push]` — push, trigger the deployment,
  poll to a terminal state, tail the deploy log on failure.
- `shopify envs doctor` — every check the other commands rely on, as a gate.
  Non-zero exit on any failure.

## The guard

Environments marked `protected = true` cannot be targeted by
`shopify app dev`: an init hook resolves the active config's `client_id`, and
if it belongs to a protected environment the command aborts before doing
anything — because dev would rewrite that app's URLs to a local tunnel.
Override deliberately with `SHOPIFY_ENVS_UNGUARD=1`. In a repo with no
`envs.toml` the hook does nothing.

## Deploy adapters

Deploy targets are adapters. Each environment declares one in
`[environments.<name>.deploy]` with `adapter = "<name>"` plus adapter-specific
config (tier references allowed). Shipping today:

| Adapter | Config | Needs |
| --- | --- | --- |
| `dokploy` | `app_id` | `DOKPLOY_API_KEY` in the shell; `DOKPLOY_URL` optional (defaults to app.dokploy.com) |

An adapter implements `status`, `pushEnv`, and `deploy` (trigger + wait); see
`src/lib/adapters/`. PRs for new targets are welcome.

## The playground convention

Give the manifest a top-level `playground` store. Any environment with no
store configured gets a hint to send its install link there for an
install/boot smoke test. The playground is an org-wide scratch store that no
project's QA depends on; anything that depends on store state (themes,
metafields, seeded data) belongs on that environment's own store.

## Prior art

The environment-bucket idea comes from
[TheBeyondGroup/shopkeeper](https://github.com/TheBeyondGroup/shopkeeper),
which does this for theme settings across stores. This plugin is the
app-and-deployment counterpart; they compose fine as fellow CLI plugins.

## License

MIT © Full Snack Lab
