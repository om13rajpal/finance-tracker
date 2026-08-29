import { describe, it, expect } from "vitest";
import { makeQueue, makeWorker } from "../../src/jobs/queue.js";

describe("job queue", () => {
  it("processes an enqueued job", async () => {
    const queue = makeQueue<{ n: number }>("test-queue");
    const results: number[] = [];

    const worker = makeWorker<{ n: number }>("test-queue", async (job) => {
      results.push(job.data.n * 2);
    });

    await queue.add("double", { n: 21 });
    await new Promise((resolve) => worker.on("completed", resolve));

    expect(results).toEqual([42]);

    await worker.close();
    await queue.close();
  });
});
