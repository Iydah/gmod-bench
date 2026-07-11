# Contributing

## Module boundary

Keep files focused and below 500 lines. Split behavior by responsibility:

- `src/fixtures/` validates and discovers fixture data.
- `src/scoring/` owns deterministic answer scoring (one file per plugin).
- `src/adapters/` owns one runner's strict invocation and wire semantics.
- `src/adapters/trace/` owns parsers (per family / provider).
- `src/core/` owns process/http execution, isolation, pooling, artifacts, doctor.
- `src/cli/` owns argument/config orchestration only.

Do not add a catch-all module or a central switch that grows for every new question or CLI.

## Adding a question

1. Create `fixtures/<id>/fixture.json` with a unique versioned ID that matches its directory, prompt, response contract, provenance URLs, verification date, and scoring definition.
2. Keep the answer out of the prompt. The oracle belongs in the public rubric/provenance, not agent context.
3. The shared response contract always runs first: `codeFenceLanguage`, `reasonPrefix`, `maxReasonLines`, `minCandidateLoops`, `maxCandidateLoops`, `maxAnswerBytes`. Loop counts include lines starting with `for` or `while`. Use `0` for both when a fenced answer has no loop.
4. Prefer a `regex` scorer for simple unambiguous cases. Patterns match the **fenced code body only** (not the reason line). Add tests for pass, partial, incorrect, and invalid format boundaries.
5. Plugin names are validated before any model is invoked. For semantic cases, add one narrow scorer under `src/scoring/`, register it in `src/scoring/index.ts`, and test format + behavior boundaries.
6. Run `bun test` and `bun run typecheck`.

## Adding a CLI adapter

An adapter may be marked `strict` only when the installed version demonstrates:

1. one-shot non-interactive mode;
2. deny-all agent tools (web/browser, file, shell, MCP);
3. structured event output that identifies tool events and exactly one final response;
4. an event parser that fails closed for unknown shapes (`trace_error`, not silent pass).

Add a dedicated module in `src/adapters/` implementing `CliAdapter` (`kind: "cli"`), fixture traces for success / tool-use / malformed / unknown events, and a probe test. Never add arbitrary user-provided command templates.

If a CLI only sandboxes or asks permission for tools, mark it `unsupported`. Post-hoc trace rejection is not a substitute for native denial.

## Adding an HTTP adapter (e.g. OpenRouter-style)

Implement `HttpAdapter` (`kind: "http"`):

1. `assessEnvironment` — fail closed without credentials;
2. `buildRequest` — answer-only (no tools/function calling);
3. `parseResponse` — fail closed on unknown shapes; treat tool_calls as `policy_violation`.

Wire it in `src/adapters/index.ts` and extend `adapterIds` in `src/adapters/types.ts`. Support multi-model config via `runners.<id>.models` and repeated `--model <id>=...` flags. Keep HTTP execution behind `HttpExecutor` so tests never hit the network.

## Status vocabulary

| Status | Use for |
| --- | --- |
| `unsupported` | Adapter cannot enter strict mode |
| `unavailable` | Binary or API key missing |
| `trace_error` | Wire format not understood |
| `protocol_error` | Bad answer shape / HTTP / exit failure |
| `policy_violation` | Tools / agent use |
| `timeout` | Deadline exceeded |
| `pass` / `partial` / `incorrect` | Scored answers only |

## Tests and validation

Write a failing Bun test before production code. Tests must never send provider prompts or depend on real credentials. Run:

```powershell
bun run check
bun run bench doctor
bun run bench list
```

`doctor` may inspect installed binaries with `--version` / `--help` and check env keys; it must not call a model.
