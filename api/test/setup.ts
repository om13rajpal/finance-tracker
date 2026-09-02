process.env.NODE_ENV ??= "test";
process.env.MONGO_URI ??= "mongodb://localhost/unused";
/**
 * DATABASE 15, NOT THE DEFAULT 0.
 *
 * Mongo is isolated per run by mongodb-memory-server, but Redis was not: the
 * tests connected to exactly the same instance and the same database a running
 * `pnpm dev:api` uses. That is a real, reproducible cross-process failure, not
 * a theoretical one: with the dev API up, two tests fail every time:
 *
 *   · priceRefreshFanout "enqueues one job per distinct symbol": the dev
 *     server's live price-refresh WORKER consumes a job out of the shared queue
 *     between the enqueue and the assertion, so only one of the two is still
 *     waiting when the test looks.
 *   · dashboard "computeFullNetWorth": a `price:INFY` key cached by ordinary
 *     dev usage is read by `getLatestPrice`, so the holding is valued at a live
 *     price instead of the cost basis the test set up.
 *
 * Both look like product bugs and neither is. A separate database index costs
 * nothing and makes the suite deterministic whether or not the app is running.
 * Still `??=`, so CI can point it wherever it likes.
 */
process.env.REDIS_URL ??= "redis://localhost:6379/15";
process.env.JWT_SECRET ??= "test-secret";
process.env.RESEND_API_KEY ??= "test-key";
process.env.ALLOWED_LOGIN_EMAIL ??= "test@example.com";
process.env.GMAIL_CLIENT_ID ??= "test-client-id";
process.env.GMAIL_CLIENT_SECRET ??= "test-client-secret";
process.env.GMAIL_REDIRECT_URI ??= "http://localhost:4000/gmail/oauth/callback";
process.env.TOKEN_ENCRYPTION_KEY ??=
  "e0db3198b886412555452c173eeb1443405380e18cb9f6ad5aac94258ba12bc2";
process.env.WEB_ORIGIN ??= "http://localhost:3000";
process.env.GMAIL_PUBSUB_TOPIC ??= "projects/test-project/topics/gmail-notifications";
process.env.GMAIL_WEBHOOK_SECRET ??= "test-webhook-secret";
// Forced blank, not left unset: a real key sitting in a developer's local
// api/.env would otherwise leak into every test run (dotenv only fills in
// keys process.env doesn't already have; see config/env.ts), making the
// suite silently start making real, slow, rate-limited network calls to
// Gemini and turning deterministic tests into flaky ones. Individual tests
// that need to exercise the LLM path mock `config/env.js` directly (see
// merchant-llm-cleanup.test.ts) rather than relying on a real key.
process.env.GEMINI_API_KEY ??= "";

import { beforeAll, afterAll, afterEach } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});
