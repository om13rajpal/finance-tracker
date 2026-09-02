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
