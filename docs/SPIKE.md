# Phase 0 spike results

Run 2026-10-05 with `npm run spike` (`scripts/spike.ts`): one Places Text Search for "breakfast cafe" around Chiswick (20 results), menu discovery on each café's site, one `claude-haiku-4-5` extraction per café.

## Verdict: go

12 of 20 cafés (60%) gave a usable breakfast menu, meeting the 60% bar. None of the other 8 has a breakfast menu online:

| Outcome | Cafés |
| --- | --- |
| No website | Mali's |
| Instagram only | Beehive, Chief Coffee, Hack & Veldt (site redirects to Instagram) |
| Site has no menu | Levent Börek, Tamp Coffee |
| Menu has no breakfast food | Waft (drinks only), Arcane (coffee, focaccia, bar snacks) |

So discovery found every breakfast menu that was available; the remaining gap is cafés that publish menus only on Instagram.

Sources of the 12 usable menus: HTML pages (6), PDFs (4), a photo of a printed menu (1), chain menu page (1, plus a duplicate branch).

## What discovery needed

Lessons that carry into `lib/menu/discover.ts`:

- **ASCII User-Agent.** Wix answers 403 to a non-ASCII User-Agent.
- **PDFs referenced from scripts.** Wix and Showit sites link menu PDFs from page scripts, not `<a>` tags; scan raw HTML for `.pdf` URLs.
- **Two hops.** Menu pages often only link to the real menu (PDFs, sub-pages).
- **Skip booking sites and prefer same-domain links.** Tock links with "breakfast" in the path outranked the café's own `/menu`.
- **Fallback for stale Google links.** A 404 store page falls back to the locale section (`/uk/`) and then the root.
- **Image menus.** A menu page with little text and no PDF: send its photos to the model. Worked, but read only part of the menu.

## Classification

Good after explicit prompt rules: egg in the dish name is never `no_egg`; cooked egg as the centre of the dish is `egg_main` even with sides; every full/house breakfast plate is `egg_component`. Egg named only in the description is caught (e.g. brioche buns with scrambled eggs), and tofu "scrambled eggs" stays `no_egg`.

## To fix in Phase 1

- The model ignores exclusion rules for catering platters and region-only items (Caffè Nero's "(NI)"); filter these in code.
- `substantial` is inconsistent (toasted sourdough marked substantial, avocado on toast not), and pastry-heavy chains rank high.
- Chains return the same national menu for each branch; group them.
- Places returns non-breakfast cafés; filter on `servesBreakfast` before extracting.
- First extraction takes 2–30 s per café.
