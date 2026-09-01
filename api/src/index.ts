import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { app } from "./app.js";
import { startBackgroundWorkers } from "./jobs/startWorkers.js";
import { startScheduleWatchdog } from "./jobs/scheduleWatchdog.js";

async function main() {
  await connectDB();
  await startBackgroundWorkers();
  // Self-healing safety net: `startBackgroundWorkers` only re-registers the
  // 5 repeatable schedules when THIS process boots. If Redis itself ever
  // restarts independently (no data persistence — see `scheduleWatchdog.ts`'s
  // doc comment for why that's a real, not theoretical, scenario on this
  // app's current Redis plan), nothing else would notice until this process's
  // own next restart. Runs for the rest of the process's life; nothing here
  // needs to stop it.
  startScheduleWatchdog();
  app.listen(Number(env.PORT), () => {
    console.log(`API listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
