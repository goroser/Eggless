# Eggless

Find a breakfast place for someone who does not eat eggs.

Search a map for cafés and see each one's breakfast menu with the egg dishes already removed, ranked by how many real egg-free options it has. Built for Inga, because brunch menus are mostly eggs.

> **Status:** Phase 1 MVP live at https://eggless-gold.vercel.app (private link). "Eggless" is a working name.

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
| Access | One secret link (`/?k=…`) stored in a cookie |
| Scheduling | Vercel Cron, nightly menu refresh (Phase 2) |

## Layout

```
app/
  page.tsx                 map + ranked café cards (components/EgglessApp.tsx)
  api/search/route.ts      Places search, joined with cached menus
  api/menu/route.ts        find, extract and classify one café's menu
proxy.ts                   secret-link gate for every page and API route
components/                CafeMap, CafeCard, EgglessApp
lib/
  places.ts                Places API client
  token.ts, access.ts      signed menu tokens, gate decision
  menu/fetch.ts            safe fetcher (no private addresses, byte caps)
  menu/discover.ts         find the menu page, PDF or photos on a café site
  menu/collect.ts          gather one café's sources
  menu/extract.ts          LLM call and zod schema
  menu/filter.ts           drop region-only, catering and drinks items
  menu/score.ts            option counts, ranking, pin colours
  db/                      Drizzle schema and menu cache
  handlers/                route logic, testable without Next
  client/                  menu queue and useCafes hook
scripts/
  spike.ts                 phase 0 extraction run over Chiswick
  smoke.ts                 live end-to-end check of a running site
docs/
  ARCHITECTURE.md, SPIKE.md, superpowers/ (Phase 1 spec and plan)
```

## Setup

1. **Google Cloud:** enable **Places API (New)** and **Maps JavaScript API**. Create:
   - a server key restricted to Places API (New) → `GOOGLE_PLACES_API_KEY`;
   - a browser key restricted by HTTP referrer to your domain and `localhost:3000`, and to the Maps JavaScript API → `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`;
   - a Map ID (Google Maps Platform → Map management, type JavaScript, vector) → `NEXT_PUBLIC_GOOGLE_MAP_ID`;
   - a quota on Places API (New) Text Search of 30 requests per day, so usage stops instead of billing.
2. **Anthropic:** an API key in a workspace → `ANTHROPIC_API_KEY`.
3. **Vercel and Neon:** `npx vercel link`, then `npx vercel integration add neon` (writes `DATABASE_URL` into `.env.local`). Run `npm run db:migrate`.
4. **Secrets:** `ACCESS_KEY` and `MENU_TOKEN_SECRET`, each from `openssl rand -base64 32`.
5. Fill `.env.local` from [.env.example](.env.example), then `bash scripts/push-env.sh` to copy it to Vercel production without printing values, and `npx vercel deploy --prod`.

Commands:

| Command | What it does |
| --- | --- |
| `npm run dev` | local site at `http://localhost:3000/?k=<ACCESS_KEY>` |
| `npm test` | unit and integration tests (no network) |
| `npm run smoke -- <url>` | live search and extraction over Chiswick against a running site |
| `npm run db:migrate` | apply migrations to `DATABASE_URL` |
| `npm run spike` | the Phase 0 script |

## Roadmap

- [x] **Phase 0, spike:** script over about 20 Chiswick cafés to measure menu coverage and classification quality. Result: go, see [docs/SPIKE.md](docs/SPIKE.md).
- [x] **Phase 1, MVP:** search, "near me", extraction, storage, map and cards, private link, deployed. Live smoke run: 14/20 Chiswick cafés usable (spike: 12/20); repeat searches served from the cache.
- [ ] **Phase 2:** ranking polish, "this is wrong" overrides, nightly refresh, PWA.
- [ ] **Phase 3:** image menus, rendering fallback, favourites, sharing.

## Next step

Phase 2. Which cafés Google returns varies between searches, and in some result sets most cafés publish no readable menu, so ranking polish and image-menu coverage matter most. Deferred review items are listed in the Phase 1 plan's ledger summary.

Open design questions are listed at the end of the architecture document.
