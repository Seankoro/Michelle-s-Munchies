import { describe, expect, it } from "vitest";
import { EMAIL_RE, escapeHtml, slugify } from "@/lib/text";
import { jsonLd } from "@/lib/json-ld";

describe("escapeHtml", () => {
  it("escapes the tag- and entity-significant characters", () => {
    expect(escapeHtml('<img src=x onerror=alert(1)> & "quotes"')).toBe(
      '&lt;img src=x onerror=alert(1)&gt; &amp; "quotes"',
    );
  });

  it("passes plain text through unchanged", () => {
    expect(escapeHtml("Basque cheesecake, 6 inch")).toBe("Basque cheesecake, 6 inch");
  });
});

describe("slugify", () => {
  it("lowercases and dashes non-alphanumerics", () => {
    expect(slugify("Choco Basque!")).toBe("choco-basque");
    expect(slugify("  Big Boy — Cookies  ")).toBe("big-boy-cookies");
  });
});

describe("EMAIL_RE", () => {
  it("accepts plausible addresses and rejects junk", () => {
    expect(EMAIL_RE.test("someone@example.com")).toBe(true);
    expect(EMAIL_RE.test("no-at-sign")).toBe(false);
    expect(EMAIL_RE.test("spaces in@example.com")).toBe(false);
  });
});

describe("jsonLd", () => {
  it("escapes < so a value can never close the script tag", () => {
    const out = jsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).toContain("\\u003c/script");
  });
});
