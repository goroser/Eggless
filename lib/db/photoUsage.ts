import { sql } from "drizzle-orm";
import type { Db } from "@/lib/db/client";
import { photoUsage } from "@/lib/db/schema";

// Counts one Google photo request on `day` (YYYY-MM-DD) and returns the day's total.
export async function incrementPhotoUsage(db: Db, day: string): Promise<number> {
  const [row] = await db
    .insert(photoUsage)
    .values({ day, count: 1 })
    .onConflictDoUpdate({ target: photoUsage.day, set: { count: sql`${photoUsage.count} + 1` } })
    .returning({ count: photoUsage.count });
  return row.count;
}
