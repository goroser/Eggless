# Phase 1 MVP design

Status: approved in conversation 2026-10-05, awaiting review of this written spec.
Builds on [ARCHITECTURE.md](../../ARCHITECTURE.md) and the Phase 0 results in [SPIKE.md](../../SPIKE.md). Where this spec and the architecture document differ, this spec wins for Phase 1.

## 1. Goal and success

The user opens one link on their phone, taps "Near me" or "Search this area", and sees breakfast cafés ranked by how many dishes they can order as they are, with egg dishes hidden.

Phase 1 is done when:

- The site is deployed on Vercel at Roman's domain and works on a phone.
- A search around Chiswick returns at least the 12 usable cafés the spike found, with menus matching the spike's quality.
- A café seen before appears instantly; a new café fills in within about 30 seconds.
- Without the secret link, nothing works, including the API routes.
- Google usage cannot exceed the daily quota set in Google Cloud.

## 2. Scope

In:

- Map with ranked café cards; "Search this area"; "Near me".
- Menu extraction with a Postgres cache.
- Secret-link access gate.
- Deterministic post-filters for items the model fails to exclude.
- Deployment to Vercel with Neon.

Out (Phase 2 or later): overrides table and "this is wrong" button, nightly refresh cron, PWA install, rendering fallback for client-side sites (Firecrawl), grouping chain branches, per-IP rate limiting, favourites, sharing.

Decisions taken for Phase 1:

| Question (ARCHITECTURE §11) | Decision |
| --- | --- |
| Public URL or shared link | Secret link, stored in a cookie |
| Do `egg_component` dishes count in the headline | No. Headline counts substantial `no_egg` dishes; `egg_component` is a second number and the tie-breaker |
| Breakfast only, or brunch and all-day | Breakfast, brunch and all-day breakfast dishes, as in the spike |
| French toast, quiche and similar | Shown unless egg is named, per the preference rule |
| Seeding | None. Chiswick is extracted on first use |

## 3. Access gate

- Env var `ACCESS_KEY`: a random string of at least 32 characters.
- `middleware.ts` runs on every route, pages and API alike, except static assets.
- `GET /?k=<ACCESS_KEY>`: if the key matches, set cookie `eggless_key=<ACCESS_KEY>` (httpOnly, Secure, SameSite=Lax, max-age one year) and redirect to `/` without the query string.
- A request with a matching cookie passes through.
- Otherwise: pages render a plain "This is a private page. Ask Roman for the link." with status 401; API routes return 401 JSON.
- The comparison uses a constant-time check.
- Rotating `ACCESS_KEY` in Vercel logs everyone out.

Because strangers cannot reach the API, there is no per-IP rate limiting in Phase 1. The Google Cloud daily quota on Places is the hard backstop.

## 4. Search: `POST /api/search`

Request body, one of:

```ts
{ rect: { low: { lat: number; lng: number }; high: { lat: number; lng: number } } }
{ near: { lat: number; lng: number } }   // converted to a rectangle of ±0.009° lat, ±0.0145° lng (about 1 km each way)
```

Steps:

1. Validate with zod. Reject a rectangle larger than about 5 km on a side (400), so one search cannot cover all of London.
2. One Places `searchText` call: `textQuery: "breakfast cafe"`, `locationRestriction.rectangle`, `pageSize: 20`. Field mask as in ARCHITECTURE §4.2.
3. Drop places with `servesBreakfast === false`. Keep `true` and unknown.
4. Load `menus` rows for the returned place IDs. A row counts as cached when it is not expired and its status is not `pending`.
5. For each place without a cached menu and with a `websiteUri`, issue a token (section 6).
6. Respond with one entry per place:

```ts
type CafeResult = {
  placeId: string;
  name: string;
  location: { lat: number; lng: number };
  rating?: number;
  userRatingCount?: number;
  openNow?: boolean;
  googleMapsUri: string;
  menu: MenuSummary | null;   // null when not cached
  token?: string;             // present when menu is null and the café has a website
};
```

`MenuSummary` holds the status, counts, `servedUntil`, `sourceUrl`, `extractedAt` and the dishes (section 8). A place with no website gets `menu: { status: "no_website", ... }` computed on the fly and is not stored.

Places API errors return 502 with a short message. A quota-exceeded error (HTTP 429 from Google) returns 503 "Daily search limit reached, try again tomorrow".

## 5. Extraction: `POST /api/menu`

Request: `{ token: string }`. Response: `MenuSummary`.

1. Verify the token (section 6). Invalid or expired: 401.
2. Check the cache. A fresh non-pending row is returned straight away.
3. Claim the café: `INSERT INTO menus (place_id, status, ...) VALUES (..., 'pending', ...) ON CONFLICT (place_id) DO UPDATE ... WHERE menus.expires_at < now() OR (menus.status = 'pending' AND menus.claimed_at < now() - interval '2 minutes')`. If no row is claimed, another request is extracting: return 202 `{ status: "pending" }` and the client retries after 3 seconds, up to 15 times.
4. Run the pipeline (section 7).
5. Replace the café's `dishes` and update the `menus` row in one transaction. Return the summary.
6. On an unexpected error, write status `fetch_failed` with a 7-day expiry, so a broken site is not retried on every search.

The route sets `export const maxDuration = 60`.

## 6. Tokens

`token = base64url(JSON{ placeId, websiteUri, exp }) + "." + base64url(HMAC-SHA256(payload, MENU_TOKEN_SECRET))`, with `exp` 10 minutes after issue. The website URL travels inside the token, so `/api/menu` never trusts a URL from the client and the server stores no Google data.

## 7. Menu pipeline (`lib/menu/`)

The spike's logic, split into focused modules. Behaviour stays as proven in the spike unless noted.

| Module | Responsibility |
| --- | --- |
| `fetch.ts` | `fetchCapped(url, maxBytes)`: 8 s timeout, byte cap, ASCII User-Agent `EgglessBot/0.1 (personal project; one fetch per cafe)`. Only `http(s)`. Refuses hosts that resolve to private, loopback or link-local addresses (new: the spike ran locally; the server must not be pointed at internal addresses). Refuses redirects to skipped hosts. `fetchHome` adds the 404 fallback: locale section, then root |
| `discover.ts` | `findCandidates(html, baseUrl)`: menu-word links, JSON-LD `hasMenu`, raw-HTML `.pdf` URLs; scoring as in the spike (breakfast/brunch +3, menu +2, food/eat +1, PDF +1, same site +2, negative words −2). `findMenuImages(html, baseUrl)` with the Wix original-size rewrite. `SKIP_HOSTS` list |
| `collect.ts` | Orchestrates one café: home page, top 3 candidates, second hop (top 3 new), up to 3 PDFs by score, up to 4 images when no PDF and the menu page has under 1,500 characters of text. Returns sources or a `no_menu_found` outcome |
| `extract.ts` | Prompt (`PROMPT_VERSION = 1`), zod `MenuSchema`, one `generateText` call with `Output.object`, `temperature: 0`, model from `LLM_MODEL` (default `claude-haiku-4-5`), optional `anthropic-workspace-id` header from `ANTHROPIC_WORKSPACE_ID` |
| `filter.ts` | New. Drops dishes the model should have excluded: names containing `(NI)` or a region marker (`(ROI)`, `(Scotland)`); names or sections matching `platter|catering|sharing box|for \d+ people`; sections whose whole name is a drinks heading (`drinks`, `hot drinks`, `coffee`, `tea`, `wine`, `cocktails`, `smoothies`, `juices`; so "Coffee & Breakfast" is kept). Then de-duplicates dishes with the same normalised name |
| `score.ts` | `counts(dishes)`: options = `no_egg` and substantial; adaptable = `egg_component`; eggMain = `egg_main`. `status(menu, counts)`: `ok`, `no_menu_found` or `no_breakfast`, as in the spike. `rank(results)`: options, then adaptable, then rating; unknown menus last |

`collect.ts` takes its fetcher as a parameter (the `MenuFetcher` interface from the architecture), so tests run on fixtures and a rendering fetcher can be added in Phase 2.

## 8. Data model (Drizzle, Neon)

`menus`, as in ARCHITECTURE §6, plus:

- `status` also allows `pending`.
- `claimed_at timestamptz`, for the pending lease.
- `sources jsonb`: every URL read (pages, PDFs, images), for debugging.

`dishes` exactly as in ARCHITECTURE §6. No `overrides` table yet.

Expiry: `ok` and `no_breakfast` 30 days; `no_menu_found` and `fetch_failed` 7 days. Expired rows are re-extracted on the next view; no cron in Phase 1.

Migrations with `drizzle-kit generate` and `drizzle-kit migrate`, checked in under `drizzle/`.

## 9. UI

One page, `app/page.tsx`, mobile-first, Tailwind.

Layout:

- Map in the top 40% of the viewport (`@vis.gl/react-google-maps`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`), initially centred on Chiswick (51.492, −0.26), zoom 15.
- Buttons over the map: "Search this area" (sends the current bounds) and "Near me" (browser geolocation, then pans the map and searches). No search on pan; an explicit tap is required. If geolocation is denied, show "Location is off; pan the map and tap Search this area".
- Below the map: the ranked list of cards. Tapping a pin scrolls to its card; tapping a card's name pans to its pin.

Pins: green for 3 or more options, amber for 1 or 2, red for 0, grey for unknown, pending or failed.

Card:

- Name, rating with count, "Open now" or "Closed".
- Headline: **"6 egg-free"** and, when non-zero, "+4 ask without egg". For unknown menus: "Menu not online", "No breakfast menu" or "Couldn't read the menu", by status.
- Top 3 substantial `no_egg` dishes with prices.
- "Show full menu": `no_egg` dishes, then "Ask without egg" dishes, then a collapsed "12 egg dishes hidden" group. Minor (non-substantial) dishes are shown in grey.
- Footer: "Menu read 5 Oct" and "served until 11:30" if known, link to the source menu, link to Google Maps.
- While extracting: a skeleton card with "Reading the menu…". The client calls `/api/menu` for at most 3 cafés at a time and re-ranks the list as each result arrives.

Page footer: "A preference filter, not an allergen guide. It only reads what the menu says."

The Google attribution required by Places is satisfied by showing results on a Google map.

## 10. Configuration

`.env.example` gains `ACCESS_KEY`. Full set: `GOOGLE_PLACES_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAP_ID`, `ANTHROPIC_API_KEY`, `ANTHROPIC_WORKSPACE_ID` (optional), `LLM_MODEL`, `DATABASE_URL`, `MENU_TOKEN_SECRET`, `ACCESS_KEY`. `CRON_SECRET` and `FIRECRAWL_API_KEY` stay in the example, unused until Phase 2.

## 11. Testing

Vitest, no network or API calls in the suite.

- `discover`: fixtures saved from real pages during the spike: Wix page with PDFs referenced only from scripts (My Place), Showit menu page (Heisenberg), a homepage where Tock links compete with `/menu`, Squarespace PDFs one hop deep (Arcane).
- `fetch`: private-address refusal, byte cap, the 404 fallback order (with a stubbed fetch).
- `collect`: end to end over a fixture fetcher.
- `filter` and `score`: hand-written dish lists, including the "(NI)" and platter cases and the ranking order.
- Tokens: round trip, tampered payload, expired token.
- Middleware: no cookie, wrong cookie, right cookie, `?k=` sets the cookie and redirects.
- `extract`: model mocked with the AI SDK's mock language model; checks the request carries the PDFs and images and that the parsed output is returned.
- `/api/menu`: the pending claim with two concurrent calls, against a test database (Neon branch or local Postgres via `DATABASE_URL_TEST`).

Plus `scripts/smoke.ts`: a live run of search plus extraction for the Chiswick rectangle against the deployed or local server, printing the same summary as the spike. Run by hand; not part of `npm test`.

## 12. Deployment

Steps that need Roman (the plan will list them in order, with the exact screens):

1. Create the Vercel project from the GitHub repo.
2. `vercel install neon` to provision the database; run migrations.
3. In Google Cloud: enable the Maps JavaScript API, create a browser key restricted by HTTP referrer to the domain (and `localhost:3000` for development), create a Map ID, and set a daily quota on Places Text Search (30 a day).
4. Add the env vars in Vercel.
5. Attach the domain.

## 13. Risks specific to Phase 1

| Risk | Mitigation |
| --- | --- |
| Extraction exceeds the function time limit on large PDFs | `maxDuration = 60`; the PDF cap of 10 MB and at most 3 PDFs; on timeout the row stays pending and the lease expires after 2 minutes |
| The secret link leaks | Rotate `ACCESS_KEY`; the Google quota still caps cost |
| First search in a new area is slow | Cards render immediately with skeletons; results fill in as they arrive |
| The model still includes off-menu items | `filter.ts` in code, and the source link on each card for checking |
