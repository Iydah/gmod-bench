import type { AdapterId, CapabilityReport, HelpProbe } from "./types";

export function strictReport(
  adapterId: AdapterId,
  probe: HelpProbe,
  requiredFlags: readonly string[],
): CapabilityReport {
  const missing = requiredFlags.filter((flag) => !probe.help.includes(flag));
  if (missing.length > 0) {
    return {
      adapterId,
      status: "unsupported",
      reason: `Missing strict-mode controls: ${missing.join(", ")}.`,
      executablePath: probe.executablePath,
      version: probe.version,
    };
  }

  return {
    adapterId,
    status: "strict",
    reason:
      "Required non-interactive, deny-all, and structured-output controls are available.",
    executablePath: probe.executablePath,
    version: probe.version,
  };
}

export function unsupportedReport(
  adapterId: AdapterId,
  probe: HelpProbe,
  reason: string,
): CapabilityReport {
  return {
    adapterId,
    status: "unsupported",
    reason,
    executablePath: probe.executablePath,
    version: probe.version,
  };
}

export function environmentReport(
  adapterId: AdapterId,
  status: CapabilityReport["status"],
  reason: string,
  version: string | null = null,
): CapabilityReport {
  return {
    adapterId,
    status,
    reason,
    executablePath: null,
    version,
  };
}
