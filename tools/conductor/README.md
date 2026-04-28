# Conductor scripts

Shims that wire this repo to [Conductor](https://conductor.build) workspaces.
Configure them in the Conductor Mac app under Repository Settings (click the
repo name in the sidebar). All scripts use `$CONDUCTOR_WORKSPACE_PATH` and, in
setup, `$CONDUCTOR_ROOT_PATH`.

## Repository Settings → Setup Script

```
bash tools/conductor/setup.sh
```

Runs once at workspace creation. Installs dependencies, copies
`.env.local` files from the root checkout (`apps/{api,dashboard,extension,mcp}`
and `packages/db`), then prebuilds `packages/*` so `typecheck`/`test`/`build`
work without an extra step.

## Repository Settings → Scripts (run buttons)

Add one entry per script. Names are suggestions; the command is what matters.

| Name | Command | Notes |
| --- | --- | --- |
| `dev` | `bash tools/conductor/run-dev.sh` | Enable **Nonconcurrent Mode** under Advanced — see below. |
| `test` | `bash tools/conductor/run-test.sh` | Unit suites only. |
| `test:integration` | `bash tools/conductor/run-test-integration.sh` | Brings up MinIO; hits the Neon dev branch. |
| `db:reset` | `bash tools/conductor/run-db-reset.sh` | Destructive: resets the shared Neon dev branch. |

### Nonconcurrent Mode

App ports are hardcoded (dashboard 3000, api 4000, mcp 4001, extension 3030),
so two workspaces can't run `dev` at once. In Repository Settings → Scripts →
Advanced, enable **Nonconcurrent Mode** for `run-dev.sh`. Conductor will
terminate the previous dev run when you start a new one.

After `run-dev.sh` is up, visit `http://localhost:3000` for the dashboard.

## Why these scripts and not `$CONDUCTOR_PORT`

Cross-app URLs (dashboard → api, extension → dashboard, mcp → api) are baked
into per-app `.env.local` files using the hardcoded localhost ports above.
Threading `$CONDUCTOR_PORT+N` through every app would require patching
`apps/dashboard/package.json`, `apps/extension/wxt.config.ts`, the api/mcp
`PORT` envs, and the cross-app URL templates. Nonconcurrent Mode is simpler
and matches single-workspace-at-a-time use.
