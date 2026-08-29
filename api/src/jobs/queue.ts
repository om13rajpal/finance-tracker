import { Queue, Worker, Job } from "bullmq";
import { redisConnection } from "../config/redis.js";

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 5000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 1000 },
};

export function makeQueue<T>(name: string): Queue<T> {
  return new Queue<T>(name, { connection: redisConnection, defaultJobOptions });
}

export function makeWorker<T>(
  name: string,
  processor: (job: Job<T>) => Promise<void>
): Worker<T> {
  return new Worker<T>(name, processor, { connection: redisConnection });
}
