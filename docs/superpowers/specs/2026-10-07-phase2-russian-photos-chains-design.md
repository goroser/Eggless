# Phase 2 design: Russian, full-screen map, photos, chains

Status: approved in conversation 2026-10-07, awaiting review of this written spec.
Builds on [the Phase 1 spec](2026-10-05-phase1-mvp-design.md) and the live Phase 1 app. Where this spec and earlier documents differ, this spec wins.

## 1. Goal and success

The user can use Eggless in Russian, can open the map full screen while walking, sees what a café looks like before going, and can hide chains.

Phase 2 is done when:

- Every piece of interface text is Russian. Every dish shows a Russian name, with the English original underneath. This includes menus that were cached before Phase 2.
- The map opens full screen from one button; tapping a pin there shows a short preview of the café without leaving the map.
- Most cards show one or two photos; no café shows a broken image.
- Known chains carry a «Сеть» badge, and one tap hides them; the choice survives a reload.
- Google photo spending cannot exceed the daily cap.
- Every Phase 1 behaviour still works, and the live smoke run is at least as good as Phase 1 (14/20 on the Chiswick rectangle, allowing for Google returning a different set).

## 2. Scope

In: the four features above, a one-off backfill of Russian translations for cached menus, and the photo cap.

Out: an English/Russian switch (Russian only), translating café names (proper names stay as Google gives them), interior-only photo selection, user-edited chain lists, overrides and the nightly refresh (still a later phase).

Decisions taken in conversation:

| Question | Decision |
| --- | --- |
| Dish names | Russian name, English original in small type underneath |
| Translation approach | The extraction call also returns Russian; a one-off script translates menus already cached |
| Photo source | The café website's own share image first; Google Places photos as fallback |
| Chain detection | Built-in list of UK chain names, plus store-finder website paths, plus a website domain shared by several cafés |
| Chain filter default | Chains shown; «Без сетей» hides them; remembered on the device |

## 3. Russian

### 3.1 Interface text

- All copy moves into `lib/i18n/ru.ts`, one exported object of strings and small formatting functions. Components import from it; no Russian or English literals remain in components.
- `<html lang="ru">`.
- Russian plurals use one helper, `plural(n, ["блюдо", "блюда", "блюд"])`, with the usual rule (1, 2–4, 5–20, and repeating by last digits; 11–14 take the third form).
- Copy, verbatim:

| Key | Text |
| --- | --- |
| searchArea | Искать здесь |
| searching | Ищем… |
| nearMe | Рядом со мной |
| hint | Нажмите «Рядом со мной» или передвиньте карту и нажмите «Искать здесь». |
| noCafes | Здесь не нашлось кафе |
| quota | Лимит поиска на сегодня исчерпан, попробуйте завтра |
| searchFailed | Поиск не удался, попробуйте ещё раз |
| locationOff | Геолокация выключена — передвиньте карту и нажмите «Искать здесь» |
| options(n) | `${n} без яиц` |
| adaptable(n) | `+${n} можно без яйца` |
| reading | Читаем меню… |
| noMenu | Меню не найдено в интернете |
| noBreakfast | Нет завтраков в меню |
| failed | Не удалось прочитать меню |
| retry | Повторить |
| showMenu / hideMenu | Всё меню / Свернуть |
| askWithoutEgg | Попросите без яйца |
| eggHidden(n) | `${n} ${plural(n, ["блюдо", "блюда", "блюд"])} с яйцом ${plural(n, ["скрыто", "скрыты", "скрыто"])}` (e.g. «2 блюда с яйцом скрыты») |
| openNow / closed | Открыто / Закрыто |
| menuRead(date) | `Меню прочитано ${d} ${monthShort}` (e.g. «Меню прочитано 5 окт») |
| servedUntil(time) | `завтраки до ${time}` |
| sourceMenu | Меню на сайте |
| googleMaps | Google Карты |
| chain | Сеть |
| hideChains | Без сетей |
| fullscreen / closeMap | Карта на весь экран / Закрыть карту |
| more | Подробнее |
| privatePage | Это личная страница. Попросите у Романа ссылку. |
| footer | Это фильтр по предпочтениям, а не по аллергенам. Мы читаем только то, что написано в меню. |

- `servedUntil` shows only when a time `HH:MM`, `H:MM`, `Hpm`/`Ham` can be found in the stored text (converted to 24-hour `HH:MM`); otherwise the line is omitted.
- Server error strings returned to the client (`/api/search` 503) become the Russian copy above.

### 3.2 Dish translations

- `Dish` gains `nameRu: string` and `descriptionRu: string`. Empty string means "not translated".
- `MenuSchema` adds both fields with descriptions telling the model: natural Russian a Russian speaker would use in a café, keep brand and proper names (e.g. "Eggs Benedict" → «Яйца Бенедикт», "Full English" → «Полный английский завтрак»), translate the description fully, never add information. The verbatim `name` and `description` rules are unchanged.
- `PROMPT_VERSION = 2`. Version 1 menus are not re-read; the backfill gives them translations.
- `dishes` table: `name_ru text not null default ''`, `description_ru text not null default ''`.
- Display: the Russian name is the main line; the English `name` is a second, smaller line in grey. When `nameRu` is empty, only the English line shows, at main size. In the full menu, `descriptionRu` (or `description` when empty) shows under each dish.
- Egg classification is still based on the English text; translation never changes `eggStatus`.

### 3.3 Backfill

`scripts/translate-cached.ts`, run once by hand (`npm run translate:cached`):

1. Select places with at least one dish where `name_ru = ''`.
2. For each, one text-only model call with the list of `{name, description}` pairs, returning the same list with `nameRu` and `descriptionRu` (zod schema, same model as extraction, temperature 0).
3. Write the translations by dish `id` in one transaction per place. A place whose call fails is skipped and reported; rerunning the script continues where it left off.
4. Print a summary: places translated, dishes translated, places failed.

## 4. Full-screen map

- A button with an expand icon (⤢, `aria-label` = fullscreen) sits at the top right of the map.
- Full screen is a CSS state: the map container becomes `fixed inset-0 z-40` with `h-dvh`; the page behind does not scroll. The same Google map instance is kept (no re-mount), so the view and pins stay put.
- In full screen:
  - A close button (✕, `aria-label` = closeMap) at top right.
  - «Искать здесь» and «Рядом со мной» stay at the bottom.
  - Tapping a pin opens a preview sheet at the bottom: name, chain badge, headline («6 без яиц», «+4 можно без яйца»), the first photo if any, and «Подробнее». Tapping the map elsewhere closes the sheet.
  - «Подробнее» leaves full screen and scrolls to that café's card.
- Opening full screen pushes a history entry, so the phone's back gesture closes the map instead of leaving the site.
- The chain filter applies to pins as well as cards.

## 5. Photos

### 5.1 Website image

- While collecting a café's sources, `collect.ts` also reads the home page's share image: `<meta property="og:image">`, then `<meta name="twitter:image">`, then the first JSON-LD `image`.
- It is kept only if: the URL is `https:`, it is not a skipped host, the URL and its `alt`/filename do not match `logo|icon|favicon|avatar|sprite|placeholder|default`, it does not end in `.svg`, and, when the page declares `og:image:width`, the width is at least 400.
- The candidate is fetched once through the safe fetcher with a 5 MB cap to check it: status 2xx, `image/*` content type, at least 30 KB. The bytes are then discarded; only the URL is kept. A candidate failing the check is dropped. The check counts against the collect time budget like any other fetch.
- `menus` gains `image_url text`. It is our own crawl result, not Google data, so it is cached with the menu.
- For menus cached before Phase 2, `image_url` is null until the menu next expires; the Google fallback covers them meanwhile.
- The browser loads the website image directly (`<img src>` with `referrerPolicy="no-referrer"`, `loading="lazy"`). If it fails to load, the card falls back to the Google photos for that café.

### 5.2 Google fallback

- `/api/search` adds `places.photos` to its field mask; this field sits in a tier the existing mask already pays for.
- For each café, the search response carries up to two photo references, each `{ ref: string; attribution: { name: string; uri: string } }`. `ref` is the photo `name` signed into a short token the same way as menu tokens (HMAC, 10 minutes), so the browser cannot request arbitrary photos. Photo references are not stored.
- New route `GET /api/photo?t=<ref>&w=<width>`:
  1. Verify the token; invalid or expired → 404.
  2. Check and increment the daily photo count (section 5.3); over the cap → 429.
  3. Call `https://places.googleapis.com/v1/<name>/media?maxWidthPx=<w>&skipHttpRedirect=true` with the server Places key; `w` is clamped to 200–800, default 400.
  4. Respond `302` to the returned `photoUri` with `Cache-Control: private, max-age=3600`. The Google key never reaches the browser.
- Google photos are requested only when shown: a card asks for its photos when it scrolls into view (`IntersectionObserver`), and only if it has no working website image.
- Each Google photo shows its author attribution as a small link over the image's bottom edge, as Google's terms require.

### 5.3 Photo cap

- Table `photo_usage (day date primary key, count int not null)`.
- `/api/photo` increments today's row (`INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`) and refuses when the count exceeds `PHOTO_DAILY_CAP` (env, default 100). The day is the UTC date.
- Also: set a Google Cloud quota on Place Photos requests of 100 per day, matching the cap.
- A card whose photos are refused shows no photo area rather than a broken image.

### 5.4 Display

- Cards show up to two square thumbnails (96 px) in a row under the header. Tapping one opens it full width in a simple overlay; tapping again closes it.
- No photo available: no photo row.

## 6. Chains

### 6.1 Detection

`lib/chains.ts` exports `isChain(input: { name: string; websiteUri?: string; sharedDomain: boolean }): boolean`, true when any of:

1. **Name list.** The normalised name (lower case, accents removed, `'` and `’` dropped) starts with one of: gails, caffe nero, cafe nero, costa, pret, starbucks, joe the juice, le pain quotidien, paul, black sheep coffee, grind, ole steen, leon, itsu, wasabi, coco di mama, puccino, notes coffee, watch house, department of coffee, blank street, origin coffee, harris hoole, greggs, the breakfast club, megans. The list lives in `lib/chains.ts` and is easy to extend.
2. **Store-finder website.** `websiteUri` has a path matching `/(stores?|locations?|shops?|branches|our-cafes|cafes|find-us)/[^/]+`.
3. **Shared domain.** `sharedDomain` is true.

Matching is on whole words at the start of the name, so "Gail's Bakery Chiswick" matches `gails`, "Leon's Kitchen" (normalised `leons kitchen`) does not match `leon`, and "Costa Rica Grill" would match `costa` (an accepted false positive; remove the entry if it bites).

### 6.2 Shared domain

- `menus` gains `site_domain text`: the registrable host of the café's home page as fetched by our crawl (lower case, `www.` removed), set when a menu is saved.
- `/api/search` computes the domain of each result's `websiteUri`, queries `select site_domain from menus where site_domain in (…) group by site_domain having count(distinct place_id) >= 2`, and passes `sharedDomain` to `isChain`.
- Also counted as shared: two or more results in the current search with the same domain.

### 6.3 Display and filter

- `CafeResult` gains `chain: boolean`.
- Card: a small grey «Сеть» badge next to the name.
- Map: chain pins use the same colour but a white glyph-less centre (hollow look).
- A «Без сетей» toggle chip sits above the card list. When on, chains are hidden from both the list and the map. The state is stored in `localStorage` under `eggless.hideChains`; reads and writes are wrapped so a blocked storage just falls back to "off".
- When the filter hides every result, the list shows `noCafes` plus a link «Показать сети» that turns the filter off.

## 7. Data model changes

Migration `0001`:

- `dishes`: add `name_ru text not null default ''`, `description_ru text not null default ''`.
- `menus`: add `image_url text`, `site_domain text`; index on `site_domain`.
- New table `photo_usage (day date primary key, count integer not null)`.

`MenuSummary` gains `imageUrl: string | null`. `CafeResult` gains `chain: boolean` and `photos: { ref: string; attribution: { name: string; uri: string } }[]`.

## 8. Testing

Vitest, no network:

- `ru.ts`: `plural` for 0, 1, 2, 4, 5, 11, 12, 21, 22, 25, 111; `menuRead` formats 5 October as «5 окт»; `servedUntil` parses "until 11:30", "Served till 11.30am", "until 12pm", returns null for "all day".
- Extraction: the fake model's Russian fields come through; `PROMPT_VERSION` is 2; the schema rejects a dish without `nameRu`.
- Backfill: over PGlite with a stub translator; only untranslated dishes are sent; a failing place is skipped and the next run picks it up.
- Website image: `og:image` picked; logo, `.svg`, `http:`, small declared width and skipped hosts rejected; `twitter:image` and JSON-LD fallbacks.
- Photo route: bad token 404; cap reached 429; width clamped; key not present in the redirect `Location`; usage counter increments atomically.
- Chains: list matches (including accents and apostrophes), the "Leon's Kitchen" non-match, store-finder paths, shared domain from the database and within one search.
- UI: card renders Russian name with English underneath and English-only when untranslated; «Сеть» badge; filter hides chains and the «Показать сети» link restores them; full-screen opens, the back gesture closes it, a pin opens the preview, «Подробнее» scrolls to the card; photos fall back from a failed website image to Google, and a refused photo shows no photo area.

Then the live checks: the backfill run, a phone-width browser pass over the full-screen map, photos and chain filter, and the smoke script against production.

## 9. Rollout

1. Migration.
2. Deploy.
3. Run `npm run translate:cached` against production.
4. Set the Google Cloud quota on Place Photos to 100 per day; add `PHOTO_DAILY_CAP` to Vercel if a value other than 100 is wanted.
5. Smoke run and phone check.

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Website share images are often logos or food shots, not the room | Logo filter; the Google fallback; accepted as a trade-off chosen in conversation |
| Google photo cost | App cap of 100 a day plus a Google Cloud quota; lazy loading; website image first |
| Translation quality of dish names | Natural-Russian instructions with examples; English always shown underneath |
| False chain positives (a local café sharing a name prefix) | Whole-word prefix matching; list kept short and editable |
| Hotlinked website images break or are slow | Lazy loading; on error, fall back to Google photos |
