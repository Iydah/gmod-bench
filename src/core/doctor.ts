import type { CliAdapter, HttpAdapter, StrictAdapter } from "../adapters/types";
import { isCliAdapter, isHttpAdapter } from "../adapters/types";
import type { CapabilityReport } from "../adapters/types";

export interface DoctorCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface DoctorExecutor {
  findExecutable(command: string): Promise<string | null>;
  run(command: string, args: string[]): Promise<DoctorCommandResult>;
}

function unavailableReport(adapter: CliAdapter): CapabilityReport {
  return {
    adapterId: adapter.id,
    status: "unavailable",
    reason: `${adapter.executable} is not on PATH.`,
    executablePath: null,
    version: null,
  };
}

function unsupportedReport(
  adapter: StrictAdapter,
  executablePath: string | null,
  version: string | null,
  detail: string,
): CapabilityReport {
  return {
    adapterId: adapter.id,
    status: "unsupported",
    reason: detail,
    executablePath,
    version,
  };
}

async function inspectCliAdapter(
  adapter: CliAdapter,
  executor: DoctorExecutor,
): Promise<CapabilityReport> {
  let executablePath: string | null;
  try {
    executablePath = await executor.findExecutable(adapter.executable);
  } catch {
    return unsupportedReport(
      adapter,
      null,
      null,
      "Executable discovery failed.",
    );
  }
  if (!executablePath) {
    return unavailableReport(adapter);
  }

  let versionResult: DoctorCommandResult;
  try {
    versionResult = await executor.run(adapter.executable, ["--version"]);
  } catch {
    return unsupportedReport(
      adapter,
      executablePath,
      null,
      "Version probe could not be started.",
    );
  }
  if (versionResult.exitCode !== 0) {
    return unsupportedReport(
      adapter,
      executablePath,
      null,
      "Version probe failed.",
    );
  }

  const version = versionResult.stdout.trim();
  let helpResult: DoctorCommandResult;
  try {
    helpResult = await executor.run(adapter.executable, adapter.helpArgs);
  } catch {
    return unsupportedReport(
      adapter,
      executablePath,
      version,
      "Help probe could not be started.",
    );
  }
  if (helpResult.exitCode !== 0) {
    return unsupportedReport(
      adapter,
      executablePath,
      version,
      "Help probe failed.",
    );
  }

  try {
    // Some CLIs (e.g. agy) write usage to stderr even when --help succeeds.
    const helpText = [helpResult.stdout, helpResult.stderr]
      .filter(Boolean)
      .join("\n");
    return adapter.assessHelp({ executablePath, version, help: helpText });
  } catch {
    return unsupportedReport(
      adapter,
      executablePath,
      version,
      "Strict capability assessment failed.",
    );
  }
}

function inspectHttpAdapter(
  adapter: HttpAdapter,
  env: NodeJS.ProcessEnv,
): CapabilityReport {
  try {
    return adapter.assessEnvironment(env);
  } catch {
    return unsupportedReport(
      adapter,
      null,
      null,
      "Strict capability assessment failed.",
    );
  }
}

export async function inspectAdapters(
  adapters: readonly StrictAdapter[],
  executor: DoctorExecutor,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CapabilityReport[]> {
  const reports: CapabilityReport[] = [];

  for (const adapter of adapters) {
    if (isHttpAdapter(adapter)) {
      reports.push(inspectHttpAdapter(adapter, env));
      continue;
    }
    if (isCliAdapter(adapter)) {
      reports.push(await inspectCliAdapter(adapter, executor));
      continue;
    }
    reports.push(
      unsupportedReport(adapter, null, null, "Unknown adapter kind."),
    );
  }

  return reports;
}

export class BunDoctorExecutor implements DoctorExecutor {
  constructor(private readonly timeoutMs = 10_000) {}

  async findExecutable(command: string): Promise<string | null> {
    return Bun.which(command) ?? null;
  }

  async run(command: string, args: string[]): Promise<DoctorCommandResult> {
    const child = Bun.spawn([command, ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(child.stdout).text();
    const stderr = new Response(child.stderr).text();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<null>((resolveTimeout) => {
      timeoutHandle = setTimeout(() => resolveTimeout(null), this.timeoutMs);
    });
    const completed = await Promise.race([child.exited, timeout]);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    if (completed === null) {
      child.kill();
      await child.exited;
    }

    const [capturedStdout, capturedStderr] = await Promise.all([
      stdout,
      stderr,
    ]);
    return {
      exitCode: completed ?? 1,
      stdout: capturedStdout,
      stderr:
        completed === null
          ? `${capturedStderr}\nProbe timed out after ${this.timeoutMs}ms.`.trim()
          : capturedStderr,
    };
  }
}
