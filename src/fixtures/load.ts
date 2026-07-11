import { readdir } from "node:fs/promises";
import { resolve, sep } from "node:path";

import type {
  BenchmarkFixture,
  FixtureOracle,
  ResponseContract,
  ScoringDefinition,
} from "../core/types";
import { validateScoringDefinition } from "../scoring";

const fixtureIdPattern = /^[a-z0-9][a-z0-9.-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Fixture field ${field} must be a non-empty string.`);
  }

  return value;
}

function readPositiveInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Fixture field ${field} must be a positive integer.`);
  }

  return value;
}

function readNonnegativeInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`Fixture field ${field} must be a non-negative integer.`);
  }

  return value;
}

function parseResponseContract(value: unknown): ResponseContract {
  if (!isRecord(value)) {
    throw new Error("Fixture responseContract must be an object.");
  }

  const minCandidateLoops = readNonnegativeInteger(
    value.minCandidateLoops,
    "responseContract.minCandidateLoops",
  );
  const maxCandidateLoops = readNonnegativeInteger(
    value.maxCandidateLoops,
    "responseContract.maxCandidateLoops",
  );
  if (minCandidateLoops > maxCandidateLoops) {
    throw new Error(
      "Fixture responseContract.minCandidateLoops cannot exceed maxCandidateLoops.",
    );
  }

  return {
    codeFenceLanguage: readString(
      value.codeFenceLanguage,
      "responseContract.codeFenceLanguage",
    ),
    reasonPrefix: readString(
      value.reasonPrefix,
      "responseContract.reasonPrefix",
    ),
    maxReasonLines: readPositiveInteger(
      value.maxReasonLines,
      "responseContract.maxReasonLines",
    ),
    minCandidateLoops,
    maxCandidateLoops,
    maxAnswerBytes: readPositiveInteger(
      value.maxAnswerBytes,
      "responseContract.maxAnswerBytes",
    ),
  };
}

function parseOracle(value: unknown): FixtureOracle {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sourceUrls) ||
    value.sourceUrls.length === 0 ||
    !value.sourceUrls.every((url) => typeof url === "string")
  ) {
    throw new Error("Fixture oracle must include at least one source URL.");
  }

  return {
    expectedPrimitive: readString(
      value.expectedPrimitive,
      "oracle.expectedPrimitive",
    ),
    sourceUrls: value.sourceUrls,
    verifiedAt: readString(value.verifiedAt, "oracle.verifiedAt"),
    rubricVersion: readString(value.rubricVersion, "oracle.rubricVersion"),
  };
}

function readStringArray(
  value: unknown,
  field: string,
  requireValue: boolean,
): string[] {
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.length > 0)
  ) {
    throw new Error(
      `Fixture field ${field} must be an array of non-empty strings.`,
    );
  }
  if (requireValue && value.length === 0) {
    throw new Error(`Fixture field ${field} must not be empty.`);
  }

  return value;
}

function parseScoring(value: unknown): ScoringDefinition {
  if (!isRecord(value)) {
    throw new Error("Fixture scoring must be an object.");
  }

  const kind = readString(value.kind, "scoring.kind");
  if (kind === "plugin") {
    return { kind, plugin: readString(value.plugin, "scoring.plugin") };
  }
  if (kind === "regex") {
    const passPatterns = readStringArray(
      value.passPatterns,
      "scoring.passPatterns",
      true,
    );
    const partialPatterns = readStringArray(
      value.partialPatterns,
      "scoring.partialPatterns",
      false,
    );
    const incorrectPatterns = readStringArray(
      value.incorrectPatterns,
      "scoring.incorrectPatterns",
      false,
    );
    for (const pattern of [
      ...passPatterns,
      ...partialPatterns,
      ...incorrectPatterns,
    ]) {
      try {
        new RegExp(pattern, "i");
      } catch {
        throw new Error(`Fixture scoring regex is invalid: ${pattern}`);
      }
    }
    return { kind, passPatterns, partialPatterns, incorrectPatterns };
  }

  throw new Error(`Unsupported fixture scoring kind: ${kind}`);
}

function parseFixture(value: unknown): BenchmarkFixture {
  if (!isRecord(value)) {
    throw new Error("Fixture JSON must be an object.");
  }

  return {
    id: readString(value.id, "id"),
    version: readPositiveInteger(value.version, "version"),
    title: readString(value.title, "title"),
    prompt: readString(value.prompt, "prompt"),
    responseContract: parseResponseContract(value.responseContract),
    oracle: parseOracle(value.oracle),
    scoring: parseScoring(value.scoring),
  };
}

function fixturePath(fixturesRoot: string, id: string): string {
  if (!fixtureIdPattern.test(id)) {
    throw new Error(`Invalid fixture id: ${id}`);
  }

  const root = resolve(fixturesRoot);
  const path = resolve(root, id, "fixture.json");
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error(`Fixture path escapes root: ${id}`);
  }

  return path;
}

export async function loadFixture(
  fixturesRoot: string,
  id: string,
): Promise<BenchmarkFixture> {
  const path = fixturePath(fixturesRoot, id);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Fixture does not exist: ${id}`);
  }

  const fixture = parseFixture(JSON.parse(await file.text()));
  if (fixture.id !== id) {
    throw new Error("Fixture id must match its directory id.");
  }
  validateScoringDefinition(fixture.scoring);
  return fixture;
}

export async function listFixtureIds(fixturesRoot: string): Promise<string[]> {
  const root = resolve(fixturesRoot);
  const entries = await readdir(root, { withFileTypes: true });
  const ids: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || !fixtureIdPattern.test(entry.name)) {
      continue;
    }
    const file = Bun.file(fixturePath(root, entry.name));
    if (await file.exists()) {
      ids.push(entry.name);
    }
  }

  return ids.sort();
}

export async function loadFixtures(
  fixturesRoot: string,
  ids: readonly string[],
): Promise<BenchmarkFixture[]> {
  const fixtures: BenchmarkFixture[] = [];
  for (const id of ids) {
    fixtures.push(await loadFixture(fixturesRoot, id));
  }
  return fixtures;
}

export async function resolveFixtureIds(
  fixturesRoot: string,
  requested: readonly string[],
): Promise<string[]> {
  if (requested.length === 1 && requested[0] === "all") {
    const ids = await listFixtureIds(fixturesRoot);
    if (ids.length === 0) {
      throw new Error("No fixtures found under fixtures/.");
    }
    return ids;
  }

  if (requested.length === 0) {
    throw new Error("At least one fixture id is required.");
  }

  // Validate ids exist early
  for (const id of requested) {
    await loadFixture(fixturesRoot, id);
  }

  return [...new Set(requested)];
}
