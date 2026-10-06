"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export function RememberPort({
  port,
  explicit,
  portIds,
}: {
  port: string;
  explicit: boolean;
  portIds: string[];
}) {
  const router = useRouter();
  useEffect(() => {
    try {
      if (explicit) localStorage.setItem("pungeo-port", port);
      else {
        const saved = localStorage.getItem("pungeo-port");
        if (saved && saved !== port && portIds.includes(saved))
          router.replace(`/sea?port=${saved}`);
      }
    } catch {
      /* Storage may be disabled. */
    }
  }, [port, explicit, router, portIds]);
  return null;
}
