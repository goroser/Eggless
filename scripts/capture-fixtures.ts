// One-off: saves real café pages used as discovery test fixtures.
// Run: npx tsx scripts/capture-fixtures.ts
import { writeFile } from "node:fs/promises";

const USER_AGENT = "EgglessBot/0.1 (personal project; one fetch per cafe)";

const PAGES: Record<string, string> = {
  "myplace-menu.html": "https://www.myplacechiswick.com/menu",
  "heisenberg-home.html": "https://heisenbergbreakfastco.com/",
  "heisenberg-menu.html": "https://heisenbergbreakfastco.com/menu",
  "arcane-our-menu.html": "https://www.arcane.london/our-menu",
};

for (const [file, url] of Object.entries(PAGES)) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const html = await res.text();
  await writeFile(`tests/fixtures/${file}`, html);
  console.log(`${file}: ${html.length} chars`);
}
