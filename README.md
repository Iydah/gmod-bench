# GMod Bench

**Find the best AI models for Garry's Mod development.**

`gmod-bench` tests how well AI models write real Garry's Mod Lua, so you can choose the right model for your next addon. It compares GMod knowledge, correctness, safety, performance choices, and consistency across public coding challenges.

Every prompt, scoring rule, model answer, and result is open for inspection. The leaderboard shows which models perform best; the underlying evidence shows why.

Models are tested with a strict response format so their answers can be compared consistently:

````text
```lua
<code>
```
Reason: <one line>
````

In the future, gmod-bench may also publish reusable GMod skills and knowledge packages that help coding models perform better. Those are a future direction, not part of the current benchmark release.

## Contents

- [What it measures](#what-it-measures)
- [Quick start](#quick-start)
- [Running the benchmark](#running-the-benchmark)
- [Reading results](#reading-results)
- [Runners and models](#runners-and-models)
- [Methodology](#methodology)
- [Fixtures and scoring](#fixtures-and-scoring)
- [Where results live](#where-results-live)
- [Development](#development)

## What it measures

The public suite covers three evidence classes:

- **API correctness:** current GMod primitives, realms, hooks, lifecycle, prediction, networking, and storage.
- **Micro-performance:** contract-equivalent choices with a measured or documented winner.
- **Production addon scenarios:** security, input bounds, cleanup, network fanout, persistence, and hot-path cost together.

Performance answers are workload-specific. A one-off `ents.FindInSphere` query and a per-tick query over addon-owned entities need different designs, so fixtures state frequency, ownership, bounds, and recipient scope when those facts change the correct answer. Unsafe or behavior-changing code cannot pass because it names a faster primitive.

The benchmark does **not** execute generated GLua inside a live GMod server. Deterministic scorers validate the answer contract and fixture-specific semantic or structural rules. Public results should therefore be read as strong regression and compliance evidence, not proof that an arbitrary addon is production-safe.

## Quick start

### Requirements

- [Bun](https://bun.sh/) for installation, tests, and the benchmark CLI.
- At least one supported model runner:
  - an installed CLI that `doctor` marks `strict`; or
  - an [OpenRouter](https://openrouter.ai/) API key.

Install dependencies and inspect the local runner capabilities:

```sh
bun install
bun run bench doctor
bun run bench list
```

`doctor` is safe: it checks installed CLI help/version surfaces and OpenRouter key readiness but never sends a model prompt.

### Run one fixture first

Choose a runner that `doctor` reports as `strict`. This example uses Codex; replace `codex` with another strict runner shown on your machine:

```sh
bun run bench run --fixture gmod.player-iterator.v1 --runners codex --repeat 1
```

This targeted command intentionally creates a new result even if the fixture ran before. It is the fastest way to confirm that the runner, strict-mode trace, scorer, and artifact pipeline all work.

For OpenRouter, copy `.env.example` to `.env`, set `OPENROUTER_API_KEY`, list the current free catalog, and select one model:

```sh
bun run bench list-models --free
bun run bench run --fixture gmod.player-iterator.v1 --runners openrouter --model openrouter=provider/model:free
```

Replace `provider/model:free` with an ID printed by `list-models`. Never commit `.env`; rotate the key if it appears in chat or a public log.

## Running the benchmark

### Run only new work

The normal full-suite command is incremental:

```sh
bun run bench run --fixture all --openrouter-free --concurrency 2
```

When `--fixture` is omitted or set to `all`, the benchmark skips exact historical slots already completed in finished runs. A slot matches on adapter, model, fixture version, rubric version, prompt hash, reasoning effort, and repeat index. New fixtures, changed rubrics, changed prompts, new models, and missing repeats still run.

Historical skipping defaults to `--history-policy scored`:

- `scored` skips completed `pass`, `partial`, and `incorrect` attempts, but retries transient failures such as timeouts or unavailable runners.
- `all` skips every matching historical attempt and minimizes provider calls or cost.

```sh
bun run bench run --fixture all --openrouter-free --history-policy all
```

Explicit fixture IDs are treated as intentional targeted reruns. Use `--rerun-all` when you deliberately want every selected slot to run again:

```sh
bun run bench run --fixture all --runners openrouter --rerun-all
```

Old run directories remain append-only and available for comparison. A rerun creates a new run; it does not overwrite prior evidence.

### Repeat for consistency

One answer can be lucky. Use multiple attempts to measure stability:

```sh
bun run bench run --fixture all --runners codex --repeat 3
```

Reports include `pass@k` (at least one pass in `k` attempts) and mean score (`pass = 1`, `partial = 0.5`, `incorrect = 0`). The CLI bounds runs to `--repeat` 1–20, `--timeout-seconds` 1–600, and `--concurrency` 1–32.

### Resume an interrupted run

Completed attempts are journaled immediately under `.gmod-bench/runs/.in-progress/<run-id>/`. Resume from that directory after a crash or interruption:

```sh
bun run bench run --fixture all --openrouter-free --resume-from .gmod-bench/runs/.in-progress/<run-id>
```

The resumed run keeps completed attempts and schedules only the remaining compatible slots. The journal is removed only after the final run directory is written atomically.

## Reading results

`bench run` prints the same Markdown report saved as `report.md`. Start with:

- **Coverage:** how many requested fixtures produced scored answers. A high pass rate over poor coverage is not a strong result.
- **Fixture score:** the ranking metric; each fixture has equal weight, repeated attempts are averaged first, and unscorable failures count as zero.
- **Scored quality:** average quality across scored attempts, kept as a diagnostic.
- **Pass rate and pass@k:** single-attempt correctness and repeated-attempt success.
- **Status counts:** separate answer quality from runner, policy, and transport failures.
- **Tokens, duration, and cost:** efficiency evidence where the provider exposes reliable usage data.

| Status                           | Meaning                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| `pass` / `partial` / `incorrect` | The response contract passed and the answer was scored.        |
| `protocol_error`                 | The final answer or provider transport was malformed.          |
| `policy_violation`               | The runner attempted tool or agent use.                        |
| `trace_error`                    | The structured event shape was unknown or contradictory.       |
| `timeout`                        | The attempt exceeded its deadline.                             |
| `unavailable`                    | The binary, API key, or required environment was missing.      |
| `unsupported`                    | The installed runner could not prove the strict-mode contract. |

Unavailable and unsupported runners are never silently counted as incorrect GMod answers.

Re-render a saved run or compare two model labels:

```sh
bun run bench report --run .gmod-bench/runs/<run-id>
bun run bench compare --run .gmod-bench/runs/<run-id> --model "Model A" --model "Model B"
```

## Runners and models

### CLI runners

CLI support is **capability-probed at runtime**. Version numbers alone are not enough. An adapter is eligible for strict scoring only when its installed help surface proves:

1. one-shot, non-interactive execution;
2. native denial of web, browser, file, shell, MCP, and other agent tools;
3. structured events that identify tool use and exactly one final response; and
4. a reviewed parser that fails closed on unknown event shapes.

Run the following whenever a CLI is installed or upgraded:

```sh
bun run bench doctor
```

The repository includes adapters for Codex, Claude, Gemini, OpenCode, agy, Grok, Cursor, and Devin. Their current status depends on the installed version and environment; the `doctor` result is authoritative. Sandboxing or permission prompts alone do not qualify as deny-all strict mode.

### OpenRouter

OpenRouter is the answer-only HTTP runner. Free and paid models use the same fixtures, response contract, scorers, reports, and artifacts.

| Mode           | Selection                                         | Limiting behavior                                                   |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Free catalog   | `--openrouter-free` or `--model openrouter=:free` | Applies the benchmark's free RPM/RPD limiter.                       |
| One free model | `--model openrouter=provider/model:free`          | Applies the free limiter.                                           |
| Paid model     | `--model openrouter=provider/model`               | Skips the free limiter; the upstream provider may still rate-limit. |
| Mixed          | Repeat `--model` with free and paid IDs           | Limits only free-model slots.                                       |

`--openrouter-free` expands to every currently eligible free text-chat model and any advertised reasoning-effort slots. It can therefore create many attempts even for one fixture. Inspect the plan with `doctor` and the live catalog with `list-models --free` before starting a broad run.

The harness requests no tools, uses deterministic sampling settings, schedules model-major for cache locality, and rejects `tool_calls` as `policy_violation`. At run start it probes the OpenRouter key limits and applies a sliding-window limiter to free attempts, including retries. Current account limits are shown by `doctor`; see the [OpenRouter limits documentation](https://openrouter.ai/docs/api/reference/limits) for the upstream policy.

Example paid or mixed runs:

```sh
bun run bench run --fixture all --runners openrouter --concurrency 8 --model openrouter=openai/gpt-4o-mini
bun run bench run --fixture gmod.player-iterator.v1 --runners openrouter --model openrouter=:free --model openrouter=openai/gpt-4o-mini
```

Provider calls can cost money. `doctor`, `list`, tests, typecheck, lint, report, compare, verify, and rebuild commands do not send model prompts.

### Free-model quarantine and denylist

A free model that repeatedly returns no answer text is temporarily quarantined so one dead endpoint cannot consume the suite's RPM budget. Inspect or clear that state with:

```sh
bun run bench quarantine
bun run bench quarantine --clear
bun run bench quarantine --clear provider/model:free
```

Known unsuitable models can also be disabled with `runners.openrouter.disabledModels` in `gmod-bench.config.json`. A base model ID disables all of its reasoning-effort slots. See `gmod-bench.config.example.json` and `gmod-bench.config.paid.example.json` for complete configurations.

## Methodology

Every scored attempt permits one final response and no tools:

````text
```lua
<code>
```
Reason: <one line>
````

CLI attempts run in a fresh empty workspace with isolated profile and temporary directories. Tool events, multiple or contradictory finals, unknown trace shapes, deadlines, and output-cap breaches fail closed as non-scored statuses. They are not reclassified as wrong GMod knowledge.

HTTP attempts send an answer-only request and fail closed on unknown response shapes or tool calls. Provider transport is required to reach the model; “no web” means no browser, web, shell, file, or MCP tool is exposed to the model by the reviewed runner configuration.

Prompts, rubrics, and provenance are public. Fixture changes use versioned IDs, rubric versions, prompt hashes, and verification dates so old and new evidence is distinguishable.

## Fixtures and scoring

List the current suite:

```sh
bun run bench list
```

Fixtures live at `fixtures/<fixture-id>/fixture.json`. Each fixture owns its prompt, provenance URLs, response contract, verification date, and scoring definition.

Shared response validation runs before fixture scoring. It checks the Lua fence, reason prefix and line count, candidate loop count, and answer byte cap. Scorers then use one of two forms:

| Scorer   | Best use                                                                    |
| -------- | --------------------------------------------------------------------------- |
| `regex`  | An unambiguous API or code shape. Patterns match the fenced code body only. |
| `plugin` | Semantic rules that need a focused module under `src/scoring/`.             |

The suite includes Facepunch-wiki-backed API questions and performance fixtures only where the required workload has a clear contract-equivalent winner. Ties, folklore, and unsafe “faster” answers are omitted. For example, all-player traversal accepts both `player.Iterator()` and a cached `player.GetAll()` numeric loop when they satisfy the fixture contract.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the evidence, versioning, scorer, test, and adapter requirements.

## Where results live

Finished runs are saved under `.gmod-bench/runs/<run-id>/`. The important pieces:

| File | What it is |
| ---- | ---------- |
| `run.json` | Full graded results for that run |
| `report.md` | Human-readable report |
| `leaderboard.json` | Per-model scores for that run |
| `attempts.jsonl` | One row per model attempt |

Public leaderboard pages at [gmodbench.com](https://gmodbench.com) are built from these runs so you can open a model’s answers and see why it ranked where it did.

```sh
bun run bench verify --all
```

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) to add fixtures, scorers, or runners.

```sh
bun run check
bun run bench doctor
bun run bench list
```

Tests and CI do not call model providers.
