import "dotenv/config";
import { z } from "zod";
import { db } from "../src/server/db";
import { phoneSchema } from "../src/lib/model";
const byId = process.argv[2] === "--user-id";
const value = byId
  ? z.string().uuid().parse(process.argv[3])
  : phoneSchema.parse(process.argv[2]);
const rows = byId
  ? await db()`UPDATE members SET admin=true WHERE id=${value} AND NOT suspended RETURNING id`
  : await db()`UPDATE members SET admin=true WHERE phone=${value} AND NOT suspended RETURNING id`;
if (!rows.length) throw new Error("An active member must sign up first.");
console.log("Operator access granted.");
await db().end();
