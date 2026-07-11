import type { APIRoute } from "astro";
import leaderboard from "../../data/leaderboard.json";
import { renderLeaderboardMarkdown } from "../../lib/discovery";

export const GET: APIRoute = () =>
  new Response(renderLeaderboardMarkdown(leaderboard), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
