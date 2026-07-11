import {
  adapterLabel,
  thinkingLabel,
  THINKING_ORDER,
} from "./leaderboard-view";

export { adapterLabel, thinkingLabel };

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const compactNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function shortRunId(runId: string): string {
  return runId.slice(0, 8);
}

export function formatRunDate(value: string | null | undefined): string {
  if (!value) return "—";
  return dateFormatter.format(new Date(value));
}

export function formatRunDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormatter.format(new Date(value));
}

export function formatDuration(
  startedAt: string,
  completedAt: string | null | undefined,
): string {
  if (!completedAt) return "—";
  const seconds = Math.max(
    0,
    Math.round(
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    ),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes < 60) {
    return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins === 0 ? `${hours}h` : `${hours}h ${mins}m`;
}

export function formatCompact(n: number): string {
  return compactNumber.format(n);
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** Strip adapter prefixes + thinking suffix for display. */
export function displayRunModel(raw: string): {
  name: string;
  thinking: string | null;
  thinkingLabel: string | null;
} {
  let name = raw.trim();
  // Drop repeated adapter/ prefixes: opencode/opencode/foo → foo
  name = name.replace(/^(?:opencode|codex|agy|openrouter|antigravity)\//gi, "");
  name = name.replace(/^(?:opencode|codex|agy|openrouter|antigravity)\//gi, "");

  // OpenRouter-style provider/model → model (nvidia/foo, cohere/bar, …)
  while (name.includes("/")) {
    name = name.slice(name.indexOf("/") + 1).trim();
  }
  name = name.replace(/:free\b/gi, "").replace(/:+$/g, "").trim();

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

  return {
    name: name || raw,
    thinking,
    thinkingLabel: thinking ? thinkingLabel(thinking) : null,
  };
}

export function adaptersLabel(adapters: string[]): string {
  return adapters.map((a) => adapterLabel(a)).join(" + ");
}

export function searchableRun(run: {
  runId: string;
  adapters: string[];
  modelIds: string[];
  fixtureIds: string[];
}): string {
  return [run.runId, ...run.adapters, ...run.modelIds, ...run.fixtureIds]
    .join(" ")
    .toLocaleLowerCase("en");
}

export function sortModelsByThinking(modelIds: string[]): string[] {
  return [...modelIds].sort((a, b) => {
    const da = displayRunModel(a);
    const db = displayRunModel(b);
    const nameCmp = da.name.localeCompare(db.name, undefined, {
      sensitivity: "base",
    });
    if (nameCmp !== 0) return nameCmp;
    const ta = da.thinking ? (THINKING_ORDER[da.thinking] ?? 50) : -1;
    const tb = db.thinking ? (THINKING_ORDER[db.thinking] ?? 50) : -1;
    return ta - tb;
  });
}
