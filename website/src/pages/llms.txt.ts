import type { APIRoute } from "astro";
import { renderLlmsIndex } from "../lib/discovery";

export const GET: APIRoute = () =>
  new Response(renderLlmsIndex(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
