# gmodbench.com

Website for [gmod-bench](https://github.com/Iydah/gmod-bench): help Garry's Mod developers compare AI models for GMod Lua coding.

## Develop

```bash
cd website
bun install
bun run dev
```

Open the URL Astro prints (default `http://localhost:4321`).

## Build

```bash
cd website
bun install
bun run build
```

From the monorepo root:

```bash
bun run website:dev
bun run website:build
```

Refresh leaderboard data before a site build:

```bash
bun run website:publish-data
```
