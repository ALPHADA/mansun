import { it, expect } from "vitest";
import { nicknameSchema } from "../src/server/board";
it("normalizes nicknames before enforcing limits", () => {
  expect(nicknameSchema.parse("  Ｓｅａ  ")).toBe("Sea");
  expect(nicknameSchema.parse("바다 회원")).toBe("바다 회원");
  expect(nicknameSchema.parse("바다  회원")).toBe("바다 회원");
});
it("rejects markup, control characters and invalid nickname lengths", () => {
  for (const name of [
    "",
    "가",
    "가".repeat(21),
    "<script>",
    "바다\n회원",
    "바다\u200b회원",
  ])
    expect(nicknameSchema.safeParse(name).success).toBe(false);
});
