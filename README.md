# Eggless

Find a breakfast place for someone who does not eat eggs.

Search a map for cafés and see each one's breakfast menu with the egg dishes already removed, ranked by how many real egg-free options it has. Built for Inga, because brunch menus are mostly eggs.

> **Status:** design stage. This repository currently holds the architecture and plan; there is no application code yet. "Eggless" is a working name.

## How it works

1. Search the map. Google Places finds breakfast cafés in view.
2. For each café, the server finds the menu on the café's own website (Google does not expose menus through its API).
3. An LLM extracts the breakfast dishes and sorts each into one of three groups:
   - **Egg is the dish** (omelette, eggs Benedict, shakshuka): hidden.
   - **Egg is a removable part** (full English, avocado toast with a poached egg): shown, tagged "ask without egg".
   - **No egg named** (porridge, granola, pancakes, bacon sandwich): shown.
4. Results are stored by Google place ID, so each café is read once and is instant afterwards.

This is a preference filter, not an allergen tool. It looks only at what the menu says and ignores hidden egg in batter, bread or sauces.

Full design: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Stack

| Layer | Choice |
| --- | --- |
| App and hosting | Next.js (App Router) on Vercel |
| Map and search | Google Maps JavaScript API, Places API (New) |
| Menu extraction | Vercel AI SDK with a schema-constrained response; model set by env var |
| Database | Neon Postgres via Vercel Marketplace, Drizzle |
| Scheduling | Vercel Cron, nightly menu refresh |

## Planned layout

```
app/
  page.tsx                 map + ranked café cards
  api/search/route.ts      Places search, joined with cached menus
  api/menu/route.ts        find, extract and classify one café's menu
  api/cron/refresh/route.ts
lib/
  places.ts                Places API client
  menu/discover.ts         find the menu page or PDF on a café site
  menu/fetch.ts            MenuFetcher interface (plain fetch, rendering fallback)
  menu/extract.ts          LLM call and zod schema
  menu/score.ts            option counts and ranking
  db/schema.ts             menus, dishes, overrides
scripts/
  spike.ts                 phase 0: run extraction over ~20 local cafés
docs/
  ARCHITECTURE.md
```

## Setup

Not runnable yet. Once the app is scaffolded, it will need:

1. A Google Cloud project with **Places API (New)** and **Maps JavaScript API** enabled, and two keys:
   - a server key restricted to the Places API;
   - a browser key restricted by HTTP referrer to the site's domain.
2. A daily quota on the Places API, so usage stops instead of billing.
3. An LLM API key.
4. A Neon database: `vercel install neon`.
5. The variables in [.env.example](.env.example), copied to `.env.local`.

## Roadmap

- [ ] **Phase 0, spike:** script over about 20 Chiswick cafés to measure menu coverage and classification quality. Go/no-go for the rest.
- [ ] **Phase 1, MVP:** search, extraction, storage, map and cards, deployed.
- [ ] **Phase 2:** ranking polish, "this is wrong" overrides, nightly refresh, PWA, "near me".
- [ ] **Phase 3:** image menus, rendering fallback, favourites, sharing.

## Next step

Start with the spike in `scripts/spike.ts`. It needs only a Places key and an LLM key, no UI and no database, and it answers the one question that decides whether the idea works: how many local cafés publish a menu that can be read.

Open design questions are listed at the end of the architecture document.
