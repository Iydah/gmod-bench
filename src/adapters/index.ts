import { agyAdapter } from "./agy";
import { claudeAdapter } from "./claude";
import { codexAdapter } from "./codex";
import { cursorAdapter } from "./cursor";
import { devinAdapter } from "./devin";
import { geminiAdapter } from "./gemini";
import { grokAdapter } from "./grok";
import { opencodeAdapter } from "./opencode";
import { openrouterAdapter } from "./openrouter";
import type { AdapterId, StrictAdapter } from "./types";

/**
 * Registry of all runners. Add a new adapter by:
 * 1) implementing with defineCliAdapter / HttpAdapter
 * 2) adding the id to adapterIds in types.ts
 * 3) registering here + auth env in environment.ts
 */
const adapters: Record<AdapterId, StrictAdapter> = {
  codex: codexAdapter,
  claude: claudeAdapter,
  gemini: geminiAdapter,
  grok: grokAdapter,
  cursor: cursorAdapter,
  devin: devinAdapter,
  openrouter: openrouterAdapter,
  agy: agyAdapter,
  opencode: opencodeAdapter,
};

export function getAdapter(id: AdapterId): StrictAdapter {
  return adapters[id];
}

export function listAdapters(): StrictAdapter[] {
  return Object.values(adapters);
}

export { adapterIds } from "./types";
export type {
  AdapterId,
  AdapterKind,
  CapabilityReport,
  CapabilityStatus,
  CliAdapter,
  HttpAdapter,
  HttpInvocationInput,
  HttpRequestSpec,
  InvocationInput,
  InvocationSpec,
  StrictAdapter,
  TraceParseResult,
  TraceStatus,
} from "./types";
export { isCliAdapter, isHttpAdapter } from "./types";
