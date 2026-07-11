import { expect, test } from "bun:test";

import { mapPool } from "../src/core/pool";

test("mapPool preserves order under concurrency", async () => {
  const started: number[] = [];
  const results = await mapPool([1, 2, 3, 4, 5], 2, async (value) => {
    started.push(value);
    await Bun.sleep(value % 2 === 0 ? 5 : 1);
    return value * 10;
  });

  expect(results).toEqual([10, 20, 30, 40, 50]);
  expect(started).toHaveLength(5);
});

test("mapPool with concurrency 1 is sequential", async () => {
  const order: number[] = [];
  await mapPool([1, 2, 3], 1, async (value) => {
    order.push(value);
    return value;
  });
  expect(order).toEqual([1, 2, 3]);
});

test("mapPool stops dequeuing after a worker rejects", async () => {
  const started: number[] = [];
  const run = mapPool([0, 1, 2, 3], 2, async (item) => {
    started.push(item);
    if (item === 0) {
      await Bun.sleep(5);
      throw new Error("boom");
    }
    await Bun.sleep(20);
    return item;
  });
  await expect(run).rejects.toThrow("boom");
  await Bun.sleep(50);
  expect(started).toEqual([0, 1]);
});
