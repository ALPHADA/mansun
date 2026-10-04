import postgres from "postgres";
const globalDb = globalThis as unknown as {
  mansunDb?: ReturnType<typeof postgres>;
};
export function db() {
  const url = process.env.MANSUN_DATABASE_URL;
  if (!url) throw new Error("MANSUN_DATABASE_URL is required");
  if (!new URL(url).pathname.slice(1).startsWith("mansun_market"))
    throw new Error("Use an isolated mansun_market database");
  return (globalDb.mansunDb ??= postgres(url, {
    max: 8,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: () => {},
  }));
}
