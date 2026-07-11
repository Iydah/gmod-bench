const bearerTokenPattern = /\bBearer\s+[A-Za-z0-9._~+\-/=]+/gi;
const namedSecretPattern =
  /\b(token|api[_-]?key|secret|password)(\s*[=:]\s*)([^\s&]+)/gi;

export function redactText(input: string, secrets: readonly string[]): string {
  let redacted = input;

  for (const secret of secrets) {
    if (secret.length > 0) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
  }

  return redacted
    .replace(bearerTokenPattern, "Bearer [REDACTED]")
    .replace(namedSecretPattern, "$1$2[REDACTED]");
}

export function collectEnvironmentSecrets(
  environment: NodeJS.ProcessEnv,
): string[] {
  return Object.entries(environment)
    .filter(
      ([name, value]) => value && /(key|token|secret|password)/i.test(name),
    )
    .map(([, value]) => value as string);
}
