import type { APIRoute } from "astro";
import { renderMethodologyMarkdown } from "../../lib/discovery";

export const GET: APIRoute = () =>
  new Response(renderMethodologyMarkdown(), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
