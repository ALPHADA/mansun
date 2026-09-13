import "server-only";
import { asc, eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db/client";
import { fishSpecies } from "@/db/schema";

export const listSpecies = cache(async () =>
  db.select().from(fishSpecies).where(eq(fishSpecies.active, true)).orderBy(asc(fishSpecies.sortOrder)));

export const speciesMap = cache(async () => {
  const rows = await listSpecies();
  return Object.fromEntries(rows.map((r) => [r.code, r]));
});
export const speciesName = async (code: string) => (await speciesMap())[code]?.name ?? code;
