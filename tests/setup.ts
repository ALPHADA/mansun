import "dotenv/config";
process.env.MANSUN_DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://localhost:5432/mansun_market_test";
if (!new URL(process.env.MANSUN_DATABASE_URL).pathname.endsWith("_test"))
  throw new Error("Tests require a dedicated _test database");
process.env.AUTH_SECRET = "test-secret-for-isolated-tests-at-least-32-bytes";
process.env.APP_ORIGIN = "http://localhost:3005";
