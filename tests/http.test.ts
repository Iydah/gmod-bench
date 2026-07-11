import { expect, test } from "bun:test";

import { BunHttpExecutor, parseRetryAfterSeconds } from "../src/core/http";

test("HTTP executor cancels a streamed body at the byte cap", async () => {
  let chunksProduced = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunksProduced += 1;
      controller.enqueue(new Uint8Array(16 * 1024));
      if (chunksProduced >= 16) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const executor = new BunHttpExecutor(
    async () => new Response(body, { status: 200 }),
  );

  const result = await executor.run(
    { url: "https://example.test", method: "POST", headers: {}, body: "" },
    { timeoutMs: 1_000, maxOutputBytes: 64 * 1024 },
  );

  expect(result.outputLimited).toBeTrue();
  expect(new TextEncoder().encode(result.body).byteLength).toBe(64 * 1024);
  expect(cancelled).toBeTrue();
  expect(chunksProduced).toBeLessThan(16);
});

test("Retry-After stays bounded", () => {
  expect(parseRetryAfterSeconds({ "retry-after": "9999" }, 1)).toBe(300);
});
