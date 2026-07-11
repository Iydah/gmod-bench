import type { APIRoute } from "astro";
import { renderLlmsFull } from "../lib/discovery";

export const GET: APIRoute = () =>
  new Response(renderLlmsFull(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
