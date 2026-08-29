import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  PORT: z.string().default("4000"),
  MONGO_URI: z.string(),
  REDIS_URL: z.string(),
  JWT_SECRET: z.string(),
  RESEND_API_KEY: z.string(),
  ALLOWED_LOGIN_EMAIL: z.string().email(),
  GMAIL_CLIENT_ID: z.string(),
  GMAIL_CLIENT_SECRET: z.string(),
  GMAIL_REDIRECT_URI: z.string(),
  TOKEN_ENCRYPTION_KEY: z.string(),
  WEB_ORIGIN: z.string(),
  GMAIL_PUBSUB_TOPIC: z.string(),
  GMAIL_WEBHOOK_SECRET: z.string(),
});

export const env = schema.parse(process.env);
