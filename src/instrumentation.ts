export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.SCHEDULER_ENABLED !== "true") return;
  const { tick } = await import("@/scheduler/tick");
  const g = globalThis as unknown as { __mansunTick?: ReturnType<typeof setInterval> };
  if (g.__mansunTick) clearInterval(g.__mansunTick);
  g.__mansunTick = setInterval(() => { tick().catch((e) => console.error("[scheduler]", e)); }, 10_000);
  console.log("[scheduler] started (10s tick)");
}
