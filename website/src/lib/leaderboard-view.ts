export interface LeaderboardRow {
  rank: number | null;
  /** Comes from generated JSON; "insufficient-coverage" is the only value emitted today. */
  rankingStatus?: string;
  adapterId: string;
  model: string;
  label: string;
  suite?: string;
  runId?: string;
  attempts: number;
  scored: number;
  pass: number;
  partial: number;
  incorrect: number;
  protocol_error: number;
  otherErrors?: number;
  passRate: number;
  quality: number;
  fixtureScore: number;
  fixtureSolveRate: number;
  coverage?: number | null;
  passAtKRate?: number | null;
  fixturesPassed?: number | null;
  fixturesAttempted?: number | null;
  avgDurationMs: number;
  passRateLabel?: string;
  qualityLabel?: string;
  fixtureScoreLabel?: string;
  fixtureSolveRateLabel?: string;
  coverageLabel?: string;
  passAtKLabel?: string;
  repeat?: number;
  evidenceAttempts?: number;
  scheduledAttempts?: number;
  verifiedRunCount?: number;
  scoreIntervalLow?: number;
  scoreIntervalHigh?: number;
  harnessFailures?: number;
  modelFormatFailures?: number;
  fixtureCoverage?: number;
}

/** 0–100 width for progress bars from a 0–1 rate (or null). */
export function rateBarWidth(rate: number | null | undefined): number {
  if (rate == null || Number.isNaN(rate)) return 0;
  return Math.max(0, Math.min(100, rate * 100));
}

/** Share of `total` as a CSS % string; never over 100. */
export function sharePct(part: number, total: number): string {
  if (!total || part <= 0) return "0%";
  return `${Math.max(0, Math.min(100, (part / total) * 100)).toFixed(2)}%`;
}

export const THINKING_ORDER: Readonly<Record<string, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  thinking: 3,
  high: 3,
  xhigh: 4,
  max: 5,
  ultra: 6,
};

export function formatMs(ms: number): string {
  if (Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatScoreInterval(
  low: number | null | undefined,
  high: number | null | undefined,
): string {
  if (low == null || high == null || !Number.isFinite(low + high)) return "—";
  return `${(low * 100).toFixed(1)}–${(high * 100).toFixed(1)}%`;
}

export function shouldShowPassAtK(models: readonly LeaderboardRow[]): boolean {
  return models.some((model) => (model.repeat ?? 1) > 1);
}

export function adapterLabel(id: string): string {
  const labels: Readonly<Record<string, string>> = {
    openrouter: "OpenRouter",
    agy: "AntiGravity",
    codex: "Codex",
    opencode: "OpenCode",
  };
  return labels[id] ?? id;
}

function parseThinking(raw: string): { name: string; thinking: string | null } {
  let name = raw;
  let thinking: string | null = null;
  const parenthesized = name.match(
    /\s*\((None|Low|Medium|Thinking|High|XHigh|Max|Ultra)\)\s*$/i,
  );
  if (parenthesized) {
    thinking = parenthesized[1]!.toLowerCase();
    name = name.slice(0, parenthesized.index).trim();
  }
  const suffix = name.match(/@(none|low|medium|high|xhigh|max|ultra)\s*$/i);
  if (suffix) {
    thinking = suffix[1]!.toLowerCase();
    name = name.slice(0, suffix.index).trim();
  }
  return { name, thinking };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Human model name only — never "codex/…", "opencode/…", or OpenRouter
 * "nvidia/…", "cohere/…", "poolside/…". Thinking suffix lives in Think column.
 */
export function displayModel(row: LeaderboardRow): string {
  // Prefer raw model id (source of truth); label often double-prefixes adapter.
  let name = (row.model || row.label || "").trim();
  if (!name) return "—";

  const adapterPrefixes = [
    row.adapterId,
    "agy",
    "openrouter",
    "codex",
    "opencode",
    "gemini",
    "claude",
    "grok",
    "cursor",
    "devin",
  ].filter(Boolean) as string[];

  // Strip every leading runner id (repeat: opencode/opencode/foo → foo).
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of adapterPrefixes) {
      const re = new RegExp(`^${escapeRegExp(id)}\\s*[\\/]\\s*`, "i");
      if (re.test(name)) {
        name = name.replace(re, "");
        changed = true;
        break;
      }
    }
  }

  // OpenRouter-style provider/model → model (nvidia/foo, cohere/bar, …).
  while (name.includes("/")) {
    name = name.slice(name.indexOf("/") + 1).trim();
  }

  // Drop routing tags that aren't part of the display name.
  name = name.replace(/:free\b/gi, "").replace(/:+$/g, "").trim();

  return parseThinking(name).name || "—";
}

export function thinkingOf(model: LeaderboardRow): string | null {
  return (
    parseThinking(model.label ?? model.model).thinking ??
    parseThinking(model.model).thinking
  );
}

export function thinkingLabel(level: string | null): string {
  if (!level) return "—";
  const labels: Readonly<Record<string, string>> = {
    none: "None",
    low: "Low",
    medium: "Medium",
    thinking: "Thinking",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
    ultra: "Ultra",
  };
  return labels[level] ?? level.charAt(0).toUpperCase() + level.slice(1);
}
