import { mkdir } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

export interface R2UploadExecutor {
  run(args: readonly string[]): Promise<void>;
}

export interface R2PublishOptions {
  bucket: string;
  publicBaseUrl: string;
  cachePath: string;
  scratchRoot: string;
  executor?: R2UploadExecutor;
}

interface ArtifactManifestEntry {
  path: string;
  bytes: number;
  sha256: string;
  role: string;
}

/** Public archive allowlist (basenames only). */
export const R2_PUBLIC_FILES = new Set([
  "run.json",
  "report.md",
  "leaderboard.json",
  "attempts.jsonl",
  "attempts.csv",
  "artifact-manifest.json",
]);

export const R2_BLOB_CACHE_CONTROL =
  "public, max-age=31536000, immutable, stale-while-revalidate=86400";

export const R2_MANIFEST_CACHE_CONTROL =
  "public, max-age=86400, stale-while-revalidate=604800";

export const R2_MAX_PUBLIC_OBJECT_BYTES = 32 * 1024 * 1024; // 32 MiB
export const R2_MAX_ANSWERS_BUNDLE_BYTES = 64 * 1024 * 1024; // 64 MiB
export const R2_MAX_ANSWER_CHARS = 200_000;

const SHA256_HEX = /^[a-f0-9]{64}$/;
const SAFE_BASENAME = /^[A-Za-z0-9._-]+$/;

export function safeRunId(runId: string): string {
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(runId))
    throw new Error(`Invalid run id for R2: ${runId}`);
  return runId;
}

export function assertSha256(hash: string): string {
  if (!SHA256_HEX.test(hash))
    throw new Error(`Invalid content hash (want 64 hex): ${hash}`);
  return hash;
}

export function isSafePublicBasename(path: string): boolean {
  return (
    R2_PUBLIC_FILES.has(path) &&
    SAFE_BASENAME.test(path) &&
    !path.includes("..") &&
    !path.includes("/") &&
    !path.includes("\\")
  );
}

function contained(root: string, relativePath: string): string {
  if (!isSafePublicBasename(relativePath))
    throw new Error(`R2 refuses non-allowlisted path: ${relativePath}`);
  const resolvedRoot = resolve(root);
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${resolvedRoot}${sep}`))
    throw new Error(`R2 source path escapes run directory: ${relativePath}`);
  return path;
}

function contentType(path: string): string {
  if (path.endsWith(".json") || path.endsWith(".jsonl"))
    return "application/json; charset=utf-8";
  if (path.endsWith(".csv")) return "text/csv; charset=utf-8";
  return "text/markdown; charset=utf-8";
}

function putArgs(options: {
  bucket: string;
  key: string;
  file: string;
  contentType: string;
  cacheControl: string;
  contentEncoding?: string;
}): string[] {
  const args = [
    "r2",
    "object",
    "put",
    `${options.bucket}/${options.key}`,
    "--file",
    options.file,
    "--content-type",
    options.contentType,
    "--cache-control",
    options.cacheControl,
    "--remote",
  ];
  if (options.contentEncoding) {
    args.push("--content-encoding", options.contentEncoding);
  }
  return args;
}

class WranglerR2Executor implements R2UploadExecutor {
  async run(args: readonly string[]): Promise<void> {
    const process = Bun.spawn(["wrangler", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
      process.exited,
    ]);
    if (exitCode !== 0)
      throw new Error(
        `wrangler ${args.join(" ")} failed (${exitCode}): ${stderr || stdout}`,
      );
  }
}

async function fileHash(
  path: string,
): Promise<{ sha256: string; bytes: number }> {
  const bytes = await Bun.file(path).arrayBuffer();
  if (bytes.byteLength > R2_MAX_PUBLIC_OBJECT_BYTES) {
    throw new Error(
      `Public object too large (${bytes.byteLength} > ${R2_MAX_PUBLIC_OBJECT_BYTES}): ${path}`,
    );
  }
  return {
    sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    bytes: bytes.byteLength,
  };
}

/** Drop diagnostic fields from published run.json. */
export function sanitizeRunJsonForPublic(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const run = raw as Record<string, unknown>;
  const attempts = Array.isArray(run.attempts) ? run.attempts : [];
  return {
    ...run,
    attempts: attempts.map((attempt) => {
      if (!attempt || typeof attempt !== "object") return attempt;
      const row = { ...(attempt as Record<string, unknown>) };
      delete row.rawOutput;
      delete row.env;
      delete row.environment;
      delete row.stdout;
      delete row.stderr;
      if (
        typeof row.finalResponse === "string" &&
        row.finalResponse.length > R2_MAX_ANSWER_CHARS
      ) {
        row.finalResponse = `${row.finalResponse.slice(0, R2_MAX_ANSWER_CHARS)}\n…[truncated]`;
      }
      return row;
    }),
  };
}

export async function publishRunToR2(
  directory: string,
  options: R2PublishOptions,
): Promise<{
  uploadedBlobs: number;
  skippedBlobs: number;
  manifestUrl: string;
}> {
  const runPath = join(directory, "run.json");
  const runRaw = (await Bun.file(runPath).json()) as {
    runId: string;
    attempts?: Array<{
      fixtureId: string;
      adapterId: string;
      model: string | null;
      attemptIndex: number;
      finalResponse: string | null;
    }>;
  };
  const runId = safeRunId(runRaw.runId);
  const publicRun = sanitizeRunJsonForPublic(runRaw);

  const manifestPath = join(directory, "artifact-manifest.json");
  const manifest = (await Bun.file(manifestPath).json()) as {
    files: ArtifactManifestEntry[];
  };
  if (!Array.isArray(manifest.files))
    throw new Error("artifact-manifest.json missing files[]");

  const entries = manifest.files.filter((entry) =>
    isSafePublicBasename(entry.path),
  );
  const sanitizedRunPath = join(
    options.scratchRoot,
    `${runId}-public-run.json`,
  );
  await mkdir(options.scratchRoot, { recursive: true });
  await Bun.write(
    sanitizedRunPath,
    `${JSON.stringify(publicRun, null, 2)}\n`,
  );
  const sanitizedRunHash = await fileHash(sanitizedRunPath);

  const toUpload: Array<{
    path: string;
    source: string;
    sha256: string;
    bytes: number;
    role: string;
  }> = [];
  const queued = new Set<string>();

  for (const entry of entries) {
    if (entry.path === "run.json") continue; // replaced by sanitized copy
    if (queued.has(entry.path)) continue;
    assertSha256(entry.sha256);
    if (
      !Number.isFinite(entry.bytes) ||
      entry.bytes < 0 ||
      entry.bytes > R2_MAX_PUBLIC_OBJECT_BYTES
    ) {
      throw new Error(
        `Invalid byte size for ${entry.path}: ${String(entry.bytes)}`,
      );
    }
    const source = contained(directory, entry.path);
    const actual = await fileHash(source);
    if (actual.sha256 !== entry.sha256) {
      throw new Error(
        `Hash mismatch for ${entry.path}: manifest ${entry.sha256} != disk ${actual.sha256}`,
      );
    }
    toUpload.push({
      path: entry.path,
      source,
      sha256: actual.sha256,
      bytes: actual.bytes,
      role: entry.role,
    });
    queued.add(entry.path);
  }

  toUpload.push({
    path: "run.json",
    source: sanitizedRunPath,
    sha256: sanitizedRunHash.sha256,
    bytes: sanitizedRunHash.bytes,
    role: "canonical",
  });
  queued.add("run.json");

  if (!queued.has("artifact-manifest.json")) {
    const provenanceHash = await fileHash(manifestPath);
    toUpload.push({
      path: "artifact-manifest.json",
      source: manifestPath,
      sha256: provenanceHash.sha256,
      bytes: provenanceHash.bytes,
      role: "provenance",
    });
  }

  let uploaded = new Set<string>();
  const cacheFile = Bun.file(options.cachePath);
  if (await cacheFile.exists()) {
    const parsed = (await cacheFile.json()) as { hashes?: string[] };
    if (Array.isArray(parsed.hashes)) {
      uploaded = new Set(
        parsed.hashes.filter((h) => typeof h === "string" && SHA256_HEX.test(h)),
      );
    }
  }
  const executor = options.executor ?? new WranglerR2Executor();
  const baseUrl = options.publicBaseUrl.replace(/\/$/, "");
  if (!/^https:\/\//i.test(baseUrl))
    throw new Error(`publicBaseUrl must be https: ${baseUrl}`);

  const objects: Array<{
    name: string;
    sha256: string;
    bytes: number;
    url: string;
  }> = [];
  let answersBundle: {
    sha256: string;
    bytes: number;
    count: number;
    url: string;
  } | null = null;
  let uploadedBlobs = 0;
  let skippedBlobs = 0;

  for (const entry of toUpload) {
    const sha256 = assertSha256(entry.sha256);
    const key = `blobs/sha256/${sha256}`;
    if (uploaded.has(sha256)) skippedBlobs += 1;
    else {
      await executor.run(
        putArgs({
          bucket: options.bucket,
          key,
          file: entry.source,
          contentType: contentType(entry.path),
          cacheControl: R2_BLOB_CACHE_CONTROL,
        }),
      );
      uploaded.add(sha256);
      uploadedBlobs += 1;
    }
    objects.push({
      name: basename(entry.path),
      sha256,
      bytes: entry.bytes,
      url: `${baseUrl}/${key}`,
    });
  }

  const answerRows = (runRaw.attempts ?? [])
    .filter((attempt) => attempt.finalResponse)
    .map((attempt) => {
      let answer = attempt.finalResponse!;
      if (answer.length > R2_MAX_ANSWER_CHARS) {
        answer = `${answer.slice(0, R2_MAX_ANSWER_CHARS)}\n…[truncated for public archive]`;
      }
      return JSON.stringify({
        fixtureId: attempt.fixtureId,
        adapterId: attempt.adapterId,
        model: attempt.model,
        attemptIndex: attempt.attemptIndex,
        answerSha256: new Bun.CryptoHasher("sha256")
          .update(answer)
          .digest("hex"),
        answer,
      });
    });
  if (answerRows.length > 0) {
    const compressed = Bun.gzipSync(
      new TextEncoder().encode(`${answerRows.join("\n")}\n`),
    );
    if (compressed.byteLength > R2_MAX_ANSWERS_BUNDLE_BYTES) {
      throw new Error(
        `Answers bundle too large (${compressed.byteLength} > ${R2_MAX_ANSWERS_BUNDLE_BYTES})`,
      );
    }
    const sha256 = assertSha256(
      new Bun.CryptoHasher("sha256").update(compressed).digest("hex"),
    );
    const key = `blobs/sha256/${sha256}`;
    if (uploaded.has(sha256)) skippedBlobs += 1;
    else {
      const bundlePath = join(options.scratchRoot, `${sha256}.jsonl.gz`);
      await Bun.write(bundlePath, compressed);
      await executor.run(
        putArgs({
          bucket: options.bucket,
          key,
          file: bundlePath,
          contentType: "application/x-ndjson",
          contentEncoding: "gzip",
          cacheControl: R2_BLOB_CACHE_CONTROL,
        }),
      );
      uploaded.add(sha256);
      uploadedBlobs += 1;
    }
    answersBundle = {
      sha256,
      bytes: compressed.byteLength,
      count: answerRows.length,
      url: `${baseUrl}/${key}`,
    };
  }

  const pointerPath = join(options.scratchRoot, `${runId}-r2-manifest.json`);
  await Bun.write(
    pointerPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        runId,
        objects,
        answersBundle,
      },
      null,
      2,
    )}\n`,
  );
  await executor.run(
    putArgs({
      bucket: options.bucket,
      key: `runs/${runId}/manifest.json`,
      file: pointerPath,
      contentType: "application/json; charset=utf-8",
      cacheControl: R2_MANIFEST_CACHE_CONTROL,
    }),
  );
  await Bun.write(
    options.cachePath,
    `${JSON.stringify({ hashes: [...uploaded].sort() }, null, 2)}\n`,
  );
  return {
    uploadedBlobs,
    skippedBlobs,
    manifestUrl: `${baseUrl}/runs/${runId}/manifest.json`,
  };
}
