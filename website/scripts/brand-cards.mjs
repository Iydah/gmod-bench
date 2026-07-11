// Brand card compositor — social-card.png (OG, 1200x630), readme-hero.png
// (2400x1000), and .github/social-preview.png (1280x640; upload manually in
// repo Settings → Social preview — GitHub has no API or file convention for
// it). Emits self-contained HTML (Geist embedded as base64) into a
// build dir, renders each in headless Chrome at the exact design size, then
// downscales/crushes. Cards carry real typography, which SVG rasterizers
// can't guarantee, so these are browser-rendered by design (same approach as
// mizan/brand/tools/compose.mjs).
//
//   bun website/scripts/brand-cards.mjs [outDir]
//
// Requires: Chrome, ffmpeg (social-card downscale), oxipng (optional crush).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[2] ?? join(WEB, "scripts", "compose");
const PUBLIC = join(WEB, "public");
mkdirSync(OUT, { recursive: true });

const font = (file) =>
  readFileSync(join(WEB, "src", "assets", "fonts", file)).toString("base64");
const geist = font("geist-sans-400.woff2");
const geistMono = font("geist-mono-500.woff2");

// The gmod "g" glyph, lifted from the logo source. Path order in the file:
// [0] blue tile, [1] white g, [2] counter of the bowl. The cards use the bare
// glyph — pearl on obsidian — so the tile is dropped and the counter is
// filled with the page color.
const logo = readFileSync(join(PUBLIC, "gmod-logo.svg"), "utf8");
const paths = [...logo.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
if (paths.length !== 3) throw new Error(`expected 3 paths in gmod-logo.svg, got ${paths.length}`);

const PAGE = "#0a0a0a"; //   site --bg
const PEARL = "#f2f3f5";
const MUTED = "#a1a1a1"; //   site --text-secondary
// The one chromatic moment: gmod blue -> site accent -> success -> gold.
const PRISM = "linear-gradient(90deg,#0081ff 0%,#70a3f3 34%,#3ecf8e 66%,#e8b84a 100%)";

// Glyph ink-bounds inside the 384 viewBox (x 40..295, y 47..338) — cropping
// to them keeps the mark optically centered in flex layouts.
const mark = (h) =>
  `<svg style="height:${h}px;width:auto;display:block" viewBox="40 47 255 291" xmlns="http://www.w3.org/2000/svg"><path fill="${PEARL}" d="${paths[1]}"/><path fill="${PAGE}" d="${paths[2]}"/></svg>`;

const page = (w, h, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Geist;src:url(data:font/woff2;base64,${geist}) format("woff2");font-weight:400}
@font-face{font-family:"Geist Mono";src:url(data:font/woff2;base64,${geistMono}) format("woff2");font-weight:500}
*{margin:0;box-sizing:border-box}
body{width:${w}px;height:${h}px;overflow:hidden;background:${PAGE};font-family:Geist,sans-serif;position:relative}
.wordmark{font-family:"Geist Mono",monospace;font-weight:500;color:${PEARL};letter-spacing:.32em;text-indent:.32em;white-space:nowrap}
.tagline{color:${MUTED};font-weight:400;white-space:nowrap}
.prism{position:absolute;left:0;right:0;bottom:0;background:${PRISM}}
</style></head><body>${body}</body></html>`;

// Social card — authored at 2x (2400x1260), downscaled to 1200x630.
// Centered stack, sitting slightly above center so the prism strip has air.
const social = page(2400, 1260, `
  <div style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center">
    ${mark(340)}
    <div class="wordmark" style="font-size:66px;margin-top:72px">GMOD-BENCH</div>
    <div class="tagline" style="font-size:40px;margin-top:30px">Which model actually writes good GLua?</div>
  </div>
  <div class="prism" style="height:12px"></div>`);

// README hero — 2400x1000, shown at 820px wide on GitHub. Horizontal lockup:
// mark left, type block right.
const hero = page(2400, 1000, `
  <div style="position:absolute;left:50%;top:47%;transform:translate(-50%,-50%);display:flex;align-items:center;gap:130px">
    ${mark(400)}
    <div>
      <div class="wordmark" style="font-size:96px;text-indent:0">GMOD-BENCH</div>
      <div class="tagline" style="font-size:46px;margin-top:38px">Which model actually writes good GLua?</div>
    </div>
  </div>
  <div class="prism" style="height:12px"></div>`);

const CHROME = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "google-chrome", "chromium"]
  .find((p) => p.includes("/") ? existsSync(p) : true);

function render(name, html, w, h) {
  const file = join(OUT, `${name}.html`);
  writeFileSync(file, html);
  execFileSync(CHROME, [
    "--headless=new", `--screenshot=${join(OUT, `${name}.png`)}`,
    `--window-size=${w},${h}`, "--hide-scrollbars", "--disable-gpu",
    `--user-data-dir=${join(OUT, ".chrome-profile")}`,
    `file:///${file.replaceAll("\\", "/")}`,
  ], { stdio: "pipe" });
  console.log(`rendered ${name}.png (${w}x${h})`);
}

// GitHub repo social preview — same design, GitHub's recommended 1280x640.
const githubSocial = page(2560, 1280, `
  <div style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center">
    ${mark(360)}
    <div class="wordmark" style="font-size:70px;margin-top:76px">GMOD-BENCH</div>
    <div class="tagline" style="font-size:42px;margin-top:32px">Which model actually writes good GLua?</div>
  </div>
  <div class="prism" style="height:12px"></div>`);

render("social-card@2x", social, 2400, 1260);
render("readme-hero", hero, 2400, 1000);
render("social-preview@2x", githubSocial, 2560, 1280);

// social card ships at the exact 1200x630 declared in SeoHead og:image:width/height
execFileSync("ffmpeg", ["-y", "-i", join(OUT, "social-card@2x.png"), "-vf", "scale=1200:630:flags=lanczos", join(OUT, "social-card.png")], { stdio: "pipe" });
execFileSync("ffmpeg", ["-y", "-i", join(OUT, "social-preview@2x.png"), "-vf", "scale=1280:640:flags=lanczos", join(OUT, "social-preview.png")], { stdio: "pipe" });
const DEST = { "social-card.png": PUBLIC, "readme-hero.png": PUBLIC, "social-preview.png": join(WEB, "..", ".github") };
for (const [f, dir] of Object.entries(DEST)) {
  try { execFileSync("oxipng", ["-o", "4", "--strip", "safe", join(OUT, f)], { stdio: "pipe" }); } catch { console.warn(`oxipng skipped for ${f}`); }
  copyFileSync(join(OUT, f), join(dir, f));
  console.log(`published ${join(dir, f)}`);
}
