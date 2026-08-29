process.env.NODE_ENV ??= "test";
process.env.MONGO_URI ??= "mongodb://localhost/unused";
process.env.REDIS_URL ??= "redis://localhost:6379";
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
