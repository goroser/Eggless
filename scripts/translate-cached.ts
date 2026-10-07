// One-off: adds Russian names and descriptions to dishes cached before prompt version 2.
// Run: npm run translate:cached   (safe to rerun; continues where it left off)
import { getDb } from "@/lib/db/client";
import { runBackfill } from "@/lib/db/translations";
import { createTranslator } from "@/lib/menu/translate";

const r = await runBackfill(getDb(), createTranslator(), console.log);
console.log(`\ntranslated ${r.dishes} dishes in ${r.places} cafés; failed: ${r.failed.length ? r.failed.join(", ") : "none"}`);
process.exit(r.failed.length ? 1 : 0);
