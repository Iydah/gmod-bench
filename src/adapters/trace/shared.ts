import type { TraceParseResult, TraceStatus } from "../types";

export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function result(
  status: TraceStatus,
  detail: string,
  finalResponse: string | null = null,
): TraceParseResult {
  return { status, detail, finalResponse };
}

export function hasToolLikeType(value: string | null): boolean {
  return (
    value !== null &&
    /(tool|command|web|mcp|function(?:[_-]?call)?)/.test(value.toLowerCase())
  );
}

export function eventContainsTool(event: JsonRecord): boolean {
  if (hasToolLikeType(text(event.type))) {
    return true;
  }

  const item = event.item;
  if (isRecord(item) && hasToolLikeType(text(item.type))) {
    return true;
  }

  if (
    "tool_call" in event ||
    "toolCall" in event ||
    "tool_use" in event ||
    "toolUse" in event
  ) {
    return true;
  }

  const message = event.message;
  if (isRecord(message) && Array.isArray(message.content)) {
    if (
      message.content.some(
        (content) => isRecord(content) && hasToolLikeType(text(content.type)),
      )
    ) {
      return true;
    }
  }

  if (Array.isArray(event.tool_calls) || Array.isArray(event.toolCalls)) {
    return true;
  }

  return false;
}

export function parseJsonLines(stdout: string): JsonRecord[] | null {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return null;
  }

  const events: JsonRecord[] = [];
  for (const line of lines) {
    try {
      const value: unknown = JSON.parse(line);
      if (!isRecord(value)) {
        return null;
      }
      events.push(value);
    } catch {
      return null;
    }
  }

  return events;
}

export function assistantText(event: JsonRecord): string | null | "invalid" {
  const message = event.message;
  if (!isRecord(message) || !Array.isArray(message.content)) {
    return "invalid";
  }

  const texts: string[] = [];
  for (const content of message.content) {
    if (!isRecord(content)) {
      return "invalid";
    }

    const type = text(content.type);
    if (type === "text") {
      const value = text(content.text);
      if (value === null) {
        return "invalid";
      }
      texts.push(value);
      continue;
    }
    if (type === "thinking" || type === "redacted_thinking") {
      continue;
    }

    return "invalid";
  }

  return texts.length > 0 ? texts.join("") : null;
}
