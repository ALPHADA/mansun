"use client";

import { usePathname } from "next/navigation";

export function BrandName() {
  const home = usePathname() === "/";
  return (
    <span className={home ? "brand-name brand-name-home" : "brand-name"}>
      {home ? "전국 수산물 경매 정보방" : "풍어"}
      <span className="brand-caption">바다의 오늘, 거래의 시작</span>
    </span>
  );
}
