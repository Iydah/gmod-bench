import { afterEach, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import {
  isSafePublicBasename,
  publishRunToR2,
  R2_BLOB_CACHE_CONTROL,
  R2_MANIFEST_CACHE_CONTROL,
  sanitizeRunJsonForPublic,
  type R2UploadExecutor,
} from "../src/storage/r2";
import { writeRunArtifacts } from "../src/report/write";
import { summarizeAttempts } from "../src/core/summary";

const root = join(import.meta.dir, ".tmp-r2-publish");
afterEach(() => rm(root, { recursive: true, force: true }));

test("uploads content-addressed public artifacts and skips cached blobs", async () => {
  const attempts = [
    {
      fixtureId: "gmod.a.v1",
      adapterId: "openrouter" as const,
      model: "m",
      attemptIndex: 1,
      status: "pass" as const,
      detail: "ok",
      finalResponse: "answer",
      durationMs: 1,
      version: "api",
      rawOutput: { stdout: "SECRET", stderr: "" },
    },
  ];
  const paths = await writeRunArtifacts(
    join(root, "runs"),
    {
      schemaVersion: 3,
      runId: "run-a",
      fixtureIds: ["gmod.a.v1"],
      startedAt: "s",
      completedAt: "c",
      repeat: 1,
      concurrency: 1,
      attempts,
      summary: summarizeAttempts(attempts),
    },
    false,
  );
  const calls: string[][] = [];
  const executor: R2UploadExecutor = {
    run: async (args) => {
      calls.push([...args]);
    },
  };
  const options = {
    bucket: "bucket",
    publicBaseUrl: "https://runs.example.com",
    cachePath: join(root, "cache.json"),
    scratchRoot: join(root, "scratch"),
    executor,
  };

  const first = await publishRunToR2(paths.directory, options);
  expect(first.uploadedBlobs).toBeGreaterThan(0);
  expect(first.manifestUrl).toBe(
    "https://runs.example.com/runs/run-a/manifest.json",
  );

  const blobPuts = calls.filter((args) =>
    args.some((value) => value.includes("/blobs/sha256/")),
  );
  expect(blobPuts.length).toBeGreaterThan(0);
  for (const args of blobPuts) {
    expect(args).toContain("--cache-control");
    expect(args).toContain(R2_BLOB_CACHE_CONTROL);
  }
  const manifestPut = calls.find((args) =>
    args.some((value) => value.endsWith("/runs/run-a/manifest.json")),
  );
  expect(manifestPut).toBeDefined();
  expect(manifestPut).toContain(R2_MANIFEST_CACHE_CONTROL);

  const firstBlobCalls = blobPuts.length;

  calls.length = 0;
  const second = await publishRunToR2(paths.directory, options);
  expect(second.uploadedBlobs).toBe(0);
  expect(
    calls.filter((args) =>
      args.some((value) => value.includes("/blobs/sha256/")),
    ),
  ).toHaveLength(0);
  expect(firstBlobCalls).toBe(second.skippedBlobs);
});

test("sanitizes rawOutput from public run.json payloads", () => {
  const cleaned = sanitizeRunJsonForPublic({
    runId: "x",
    attempts: [
      {
        finalResponse: "ok",
        rawOutput: { stdout: "secret", stderr: "nope" },
        env: { KEY: "value" },
      },
    ],
  }) as {
    attempts: Array<Record<string, unknown>>;
  };
  expect(cleaned.attempts[0]!.rawOutput).toBeUndefined();
  expect(cleaned.attempts[0]!.env).toBeUndefined();
  expect(cleaned.attempts[0]!.finalResponse).toBe("ok");
});

test("rejects path traversal and non-allowlisted basenames", () => {
  expect(isSafePublicBasename("run.json")).toBe(true);
  expect(isSafePublicBasename("../run.json")).toBe(false);
  expect(isSafePublicBasename("raw/secret.log")).toBe(false);
  expect(isSafePublicBasename(".env")).toBe(false);
});
