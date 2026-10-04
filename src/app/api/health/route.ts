import {db} from '@/server/db';
export async function GET(){try{await db()`SELECT 1`;return Response.json({status:'ok',service:'mansun-market'},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({status:'unavailable'},{status:503});}}
