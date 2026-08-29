import { redisConnection } from "../config/redis.js";

export async function getCached<T>(key: string): Promise<T | null> {
  const raw = await redisConnection.get(key);
  return raw ? (JSON.parse(raw) as T) : null;
}

export async function setCached<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  await redisConnection.set(key, JSON.stringify(value), "EX", ttlSeconds);
}

export async function deleteCached(key: string): Promise<void> {
  await redisConnection.del(key);
}
