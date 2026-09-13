import { describe, it, expect } from "vitest";
import { won, remainingLabel, localDateStr, kstDateTime, toLocalInput } from "@/lib/format";

describe("포맷터", () => {
  it("원화", () => { expect(won(2880000)).toBe("2,880,000원"); expect(won(null)).toBe("-"); });
  it("남은 시간", () => {
    expect(remainingLabel(0)).toBe("마감");
    expect(remainingLabel(65_000)).toBe("01:05");
    expect(remainingLabel(3_600_000 + 61_000)).toBe("1:01:01");
  });
  it("KST 날짜/시각 변환 왕복", () => {
    const d = kstDateTime("2026-05-12", "06:30");
    expect(d.toISOString()).toBe("2026-05-11T21:30:00.000Z");
    expect(localDateStr(d)).toBe("2026-05-12");
    expect(toLocalInput(d)).toBe("2026-05-12T06:30");
  });
});
