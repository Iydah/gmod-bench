import { parseCliArgs } from "./cli/args";
import { loadBenchConfig } from "./cli/config";
import {
  defaultBenchPaths,
  defaultCommandRuntime,
  executeCompare,
  executeDoctor,
  executeList,
  executeListModels,
  executeQuarantine,
  executeReport,
  executeRun,
  formatDoctorReport,
  formatOpenRouterQuotaNote,
} from "./cli/commands";
import { renderMarkdownReport } from "./report/markdown";
import { rebuildRunExports, verifyRunDirectory } from "./report/maintenance";
import { rebuildCompletedSlotIndex } from "./run/completed-index";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

function runDirectory(path: string): string {
  const resolved = resolve(path);
  return resolved.endsWith("run.json") ? dirname(resolved) : resolved;
}

export async function main(
  argv: readonly string[],
  projectRoot = process.cwd(),
): Promise<string> {
  const args = parseCliArgs(argv);
  const paths = defaultBenchPaths(projectRoot);
  const runtime = defaultCommandRuntime();

  if (args.command === "doctor") {
    const reports = await executeDoctor(args, runtime);
    const config = await loadBenchConfig(paths.configPath);
    const quota = await formatOpenRouterQuotaNote(
      args.runners,
      process.env,
      config,
    );
    return formatDoctorReport(reports) + (quota ?? "");
  }
  if (args.command === "list") {
    return executeList(paths);
  }
  if (args.command === "list-models") {
    return executeListModels(args.freeOnly, runtime);
  }
  if (args.command === "report") {
    return executeReport(args.runPath);
  }
  if (args.command === "quarantine") {
    return executeQuarantine(args, paths);
  }
  if (args.command === "compare") {
    return executeCompare(args);
  }
  if (args.command === "verify") {
    const directories: string[] = [];
    if (args.all) {
      for (const entry of await readdir(paths.artifactRoot, {
        withFileTypes: true,
      })) {
        if (
          !entry.isDirectory() ||
          entry.name.startsWith(".") ||
          /checkpoint/i.test(entry.name)
        )
          continue;
        const directory = join(paths.artifactRoot, entry.name);
        try {
          const metadata = (await Bun.file(
            join(directory, "metadata.json"),
          ).json()) as { completedAt?: unknown };
          if (typeof metadata.completedAt === "string")
            directories.push(directory);
        } catch {
          continue;
        }
      }
    } else {
      directories.push(runDirectory(args.runPath!));
    }
    const lines: string[] = [];
    let failures = 0;
    for (const directory of directories) {
      const result = await verifyRunDirectory(directory);
      if (!result.ok) failures += 1;
      lines.push(
        `${result.ok ? "PASS" : "FAIL"} ${directory}${result.issues.length ? `\n  ${result.issues.join("\n  ")}` : ""}`,
      );
    }
    if (failures)
      throw new Error(
        `${failures} run(s) failed verification.\n${lines.join("\n")}`,
      );
    return lines.join("\n");
  }
  if (args.command === "rebuild-exports") {
    const directory = runDirectory(args.runPath);
    await rebuildRunExports(directory);
    return `Rebuilt derived exports for ${directory}`;
  }
  if (args.command === "rebuild-index") {
    const result = await rebuildCompletedSlotIndex(paths.artifactRoot);
    return `Rebuilt ${result.entries} completed-slot index entries at ${result.path}`;
  }

  const result = await executeRun(args, paths, runtime);
  if (result.kind === "no-work") return result.message;
  return renderMarkdownReport(result.artifact);
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((output) => console.log(output))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
