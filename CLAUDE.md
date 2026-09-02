# Deployment workflow

Whenever you push code, sync both remotes every time, even if the commit only touches `web/`. None of this happens on its own.

1. **Push to `origin` (`om13rajpal/finance-tracker`)**: the real repo.
2. **Sync the fork (`omrajpal13274/finance-tracker`)**: this is what Render's API service actually watches, not `origin`. Push the same commit there too, always, regardless of what changed:
   ```
   git push https://github.com/omrajpal13274/finance-tracker.git main
   ```
3. **Trigger the Render deploy manually**: Render is connected with `autoDeploy: yes`, but in practice it does not reliably deploy on its own once the fork is updated. Call `trigger_deploy` (Render MCP) for the API service (`srv-da9de79srm7s73c0t8hg`) after step 2, and confirm the resulting deploy reaches `status: "live"` before considering the push shipped.

**Vercel (the web app) deploys automatically** from a push to `origin`, no manual step needed there. Still do steps 2 and 3 anyway so the fork never drifts out of sync, even on a web-only change.

## GitHub auth note

Two `gh` accounts are both authenticated on this machine and only one can be "active" at a time. Pushes silently 403 if the wrong one is active:

```
gh auth switch -u om13rajpal      # before pushing to origin
gh auth switch -u omrajpal13274   # before pushing to the fork
```

Switch to whichever account matches the remote you're about to push to.

## Infrastructure

- **Redis (BullMQ queues)**: `finance-tracker-redis`, a Render-managed Key Value instance (`red-dabesv710e5c73fq8cmg`), internal URL `redis://red-dabesv710e5c73fq8cmg:6379`. Migrated off Upstash on 2026-09-01 after Upstash's free-tier 500k-request quota was exhausted and started rejecting every command, which broke all BullMQ job processing app-wide (Gmail watch renewal, statement processing, price refresh, etc.) until the migration. The internal URL only resolves from inside Render's private network (e.g. from the API service), not from a local machine.
