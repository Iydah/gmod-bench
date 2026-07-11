/**
 * Bounded concurrent map preserving input order.
 * Used so multi-model / multi-fixture OpenRouter runs stay fast without unbounded fan-out.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) {
    return [];
  }

  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = Array.from<R>({ length: items.length });
  let nextIndex = 0;
  let stopped = false;
  let failed = false;
  let firstError: unknown;

  async function runWorker(): Promise<void> {
    while (!stopped) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }
      try {
        results[index] = await worker(items[index] as T, index);
      } catch (error) {
        if (!stopped) {
          stopped = true;
          failed = true;
          firstError = error;
        }
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  if (failed) {
    throw firstError;
  }
  return results;
}
