import { env } from "./config/env.js";
import { connectDB } from "./config/db.js";
import { app } from "./app.js";
import { startBackgroundWorkers } from "./jobs/startWorkers.js";

async function main() {
  await connectDB();
  await startBackgroundWorkers();
  app.listen(Number(env.PORT), () => {
    console.log(`API listening on :${env.PORT}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
