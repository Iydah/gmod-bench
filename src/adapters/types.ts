export const adapterIds = [
  "codex",
  "claude",
  "gemini",
  "grok",
  "cursor",
  "devin",
  "openrouter",
  "agy",
  "opencode",
] as const;

export type AdapterId = (typeof adapterIds)[number];
export type AdapterKind = "cli" | "http";
export type CapabilityStatus = "strict" | "unsupported" | "unavailable";

export interface CapabilityReport {
  adapterId: AdapterId;
  status: CapabilityStatus;
  reason: string;
  executablePath: string | null;
  version: string | null;
}

export interface HelpProbe {
  executablePath: string;
  version: string;
  help: string;
}

export interface InvocationInput {
  prompt: string;
  workspace: string;
  schemaPath: string;
  policyPath?: string;
  model?: string;
}

export interface InvocationSpec {
  command: string;
  args: string[];
}

export type TraceStatus =
  "complete" | "policy_violation" | "protocol_error" | "trace_error";

export interface TraceParseResult {
  status: TraceStatus;
  detail: string;
  finalResponse: string | null;
}

export interface HttpRequestSpec {
  url: string;
  method: "POST";
  headers: Record<string, string>;
  body: string;
}

export interface HttpInvocationInput {
  prompt: string;
  /**
   * Model id or slot id. OpenRouter slots may encode reasoning effort as
   * `provider/model@high` (see openrouter-slots.ts).
   */
  model: string;
  maxAnswerBytes: number;
  /** Optional run id used for OpenRouter session_id sticky routing. */
  runId?: string;
  /** OpenRouter edge response cache (default true). */
  responseCache?: boolean;
  /** OpenRouter provider.sort preference; false disables sort. */
  providerSort?: "price" | "throughput" | "latency" | false;
  /** Explicit reasoning effort (overrides `@effort` in model when set). */
  reasoningEffort?:
    "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
  /** OpenRouter catalog supported_parameters for this model (optional). */
  supportedParameters?: readonly string[];
}

/** Shared fields for every runner (CLI or HTTP). */
export interface AdapterBase {
  id: AdapterId;
  kind: AdapterKind;
  displayName: string;
}

export interface CliAdapter extends AdapterBase {
  kind: "cli";
  executable: string;
  helpArgs: string[];
  assessHelp(probe: HelpProbe): CapabilityReport;
  createInvocation(input: InvocationInput): InvocationSpec;
  parseTrace(stdout: string, stderr: string): TraceParseResult;
}

export interface HttpAdapter extends AdapterBase {
  kind: "http";
  /** Whether the environment can run this adapter in strict mode. */
  assessEnvironment(env: NodeJS.ProcessEnv): CapabilityReport;
  buildRequest(input: HttpInvocationInput): HttpRequestSpec;
  parseResponse(statusCode: number, body: string): TraceParseResult;
}

export type StrictAdapter = CliAdapter | HttpAdapter;

export function isCliAdapter(adapter: StrictAdapter): adapter is CliAdapter {
  return adapter.kind === "cli";
}

export function isHttpAdapter(adapter: StrictAdapter): adapter is HttpAdapter {
  return adapter.kind === "http";
}
