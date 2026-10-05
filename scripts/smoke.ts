// Live end-to-end check against a running Eggless (local or deployed).
// Run: npm run smoke -- http://localhost:3000   (needs ACCESS_KEY in .env.local)
// Uses one Places search and, for uncached cafés, one LLM call each.

type Menu = { status: string; counts: { options: number; adaptable: number } | null };
type Cafe = { placeId: string; name: string; menu: Menu | null; token?: string };

const base = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const key = process.env.ACCESS_KEY;
if (!key) throw new Error("ACCESS_KEY is not set");
const headers = { "Content-Type": "application/json", Cookie: `eggless_key=${key}` };

// The Phase 0 spike's Chiswick rectangle.
const CHISWICK = { low: { lat: 51.486, lng: -0.275 }, high: { lat: 51.498, lng: -0.245 } };

async function menuFor(token: string): Promise<Menu> {
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${base}/api/menu`, { method: "POST", headers, body: JSON.stringify({ token }) });
    if (res.status === 200) return (await res.json()) as Menu;
    if (res.status !== 202 && res.status !== 503) return { status: `http_${res.status}`, counts: null };
    await new Promise((r) => setTimeout(r, 3000));
  }
  return { status: "timeout", counts: null };
}

async function main() {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/search`, { method: "POST", headers, body: JSON.stringify({ rect: CHISWICK }) });
  if (!res.ok) throw new Error(`search failed: HTTP ${res.status} ${await res.text()}`);
  const { cafes } = (await res.json()) as { cafes: Cafe[] };
  const cachedCount = cafes.filter((c) => c.menu).length;
  console.log(`${cafes.length} cafés, ${cachedCount} cached`);

  const todo = cafes.filter((c) => !c.menu && c.token);
  for (let i = 0; i < todo.length; i += 3) {
    await Promise.all(
      todo.slice(i, i + 3).map(async (c) => {
        c.menu = await menuFor(c.token!);
        console.log(`  ${c.name}: ${c.menu.status}`);
      }),
    );
  }

  const by = new Map<string, number>();
  for (const c of cafes) by.set(c.menu?.status ?? "none", (by.get(c.menu?.status ?? "none") ?? 0) + 1);
  console.log("\n================ SUMMARY ================");
  for (const [s, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(14)} ${String(n).padStart(3)}`);
  const ok = by.get("ok") ?? 0;
  console.log(`\ncoverage (usable menu): ${ok}/${cafes.length} = ${Math.round((ok / Math.max(cafes.length, 1)) * 100)}%   spike: 12/20`);
  console.log(`took ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log("\nranking:");
  for (const c of cafes.filter((c) => c.menu?.status === "ok")) {
    console.log(`  ${String(c.menu!.counts?.options ?? 0).padStart(2)} options, ${c.menu!.counts?.adaptable ?? 0} adaptable  ${c.name}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
