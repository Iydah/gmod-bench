import { expect, test } from "bun:test";

import { redactText } from "../src/core/redaction";

test("redacts configured secrets and common bearer token shapes", () => {
  const text = "Authorization: Bearer sk-secret-value and token=abc123";

  expect(redactText(text, ["abc123"])).toBe(
    "Authorization: Bearer [REDACTED] and token=[REDACTED]",
  );
});

test("redacts header-style credential values before raw artifacts are written", () => {
  const text = "x-api-key: leaked-value\npassword: another-leak";

  expect(redactText(text, [])).toBe(
    "x-api-key: [REDACTED]\npassword: [REDACTED]",
  );
});
