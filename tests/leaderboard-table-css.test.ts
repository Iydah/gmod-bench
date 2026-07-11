import { expect, test } from "bun:test";

const stylesheet = await Bun.file(
  new URL("../website/src/styles/leaderboard-table.css", import.meta.url),
).text();
const component = await Bun.file(
  new URL("../website/src/components/LeaderboardTable.astro", import.meta.url),
).text();

test("leaderboard sort headers reserve indicator space without shifting labels", () => {
  expect(stylesheet).toContain("visibility: hidden;");
  expect(stylesheet).toContain('th[aria-sort="ascending"]::after');
  expect(stylesheet).toContain('th[aria-sort="descending"]::after');
  expect(stylesheet).toContain('th[data-sort="rank"]::after');
  expect(stylesheet).toContain("position: absolute;");
  expect(stylesheet).toContain("min-width: 70rem;");
});

test("leaderboard calls malformed model answers invalid output, not format failures", () => {
  expect(component).toContain("Invalid output");
  expect(component).not.toContain("Format failures");
  expect(component).not.toContain(">Format<");
});
