import { join } from "node:path";

import {
  BunModelsHttpClient,
  type ModelsHttpClient,
} from "../adapters/openrouter-models";
import { BunDoctorExecutor, type DoctorExecutor } from "../core/doctor";
import { BunHttpExecutor, type HttpExecutor } from "../core/http";
import { BunProcessExecutor, type ProcessExecutor } from "../core/process";
import type { RunArtifact } from "../core/types";
import type { RunArtifactPaths } from "../report/write";

export interface BenchPaths {
  projectRoot: string;
  fixturesRoot: string;
  configPath: string;
  artifactRoot: string;
  scratchRoot: string;
}

export interface CommandRuntime {
  doctorExecutor: DoctorExecutor;
  processExecutor: ProcessExecutor;
  httpExecutor: HttpExecutor;
  modelsHttpClient?: ModelsHttpClient;
  now(): Date;
  createRunId(): string;
  env?: NodeJS.ProcessEnv;
  log?: (message: string) => void;
}

export interface CompletedRunCommandResult {
  kind: "completed";
  artifact: RunArtifact;
  paths: RunArtifactPaths;
}

export interface NoWorkRunCommandResult {
  kind: "no-work";
  message: string;
}

export type RunCommandResult =
  CompletedRunCommandResult | NoWorkRunCommandResult;

export function defaultBenchPaths(projectRoot: string): BenchPaths {
  return {
    projectRoot,
    fixturesRoot: join(projectRoot, "fixtures"),
    configPath: join(projectRoot, "gmod-bench.config.json"),
    artifactRoot: join(projectRoot, ".gmod-bench", "runs"),
    scratchRoot: join(projectRoot, ".gmod-bench", "scratch"),
  };
}

export function defaultCommandRuntime(): CommandRuntime {
  return {
    doctorExecutor: new BunDoctorExecutor(),
    processExecutor: new BunProcessExecutor(),
    httpExecutor: new BunHttpExecutor(),
    modelsHttpClient: new BunModelsHttpClient(),
    now: () => new Date(),
    createRunId: () => crypto.randomUUID(),
    log: (message) => console.error(message),
  };
}
