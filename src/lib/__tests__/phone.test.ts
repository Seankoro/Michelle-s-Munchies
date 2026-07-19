import { describe, expect, it } from "vitest";
import { isValidSgPhone, normalizeSgPhone } from "@/lib/phone";

describe("isValidSgPhone", () => {
  it("accepts 8-digit mobiles starting with 8 or 9", () => {
    expect(isValidSgPhone("91234567")).toBe(true);
    expect(isValidSgPhone("81234567")).toBe(true);
  });

  it("accepts +65 and 65 prefixes, spaces, and dashes", () => {
    expect(isValidSgPhone("+65 9123 4567")).toBe(true);
    expect(isValidSgPhone("6591234567")).toBe(true);
    expect(isValidSgPhone("9123-4567")).toBe(true);
  });

  it("rejects landlines, short, and long numbers", () => {
    expect(isValidSgPhone("61234567")).toBe(false); // 6 = landline prefix
    expect(isValidSgPhone("9123456")).toBe(false); // 7 digits
    expect(isValidSgPhone("912345678")).toBe(false); // 9 digits
    expect(isValidSgPhone("")).toBe(false);
    expect(isValidSgPhone("hello")).toBe(false);
  });
});

describe("normalizeSgPhone", () => {
  it("normalizes every accepted form to '+65 XXXX XXXX'", () => {
    expect(normalizeSgPhone("91234567")).toBe("+65 9123 4567");
    expect(normalizeSgPhone("+65 9123 4567")).toBe("+65 9123 4567");
    expect(normalizeSgPhone("6598765432")).toBe("+65 9876 5432");
  });

  it("returns null for invalid input", () => {
    expect(normalizeSgPhone("61234567")).toBeNull();
    expect(normalizeSgPhone("abc")).toBeNull();
  });
});
