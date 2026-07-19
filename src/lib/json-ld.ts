/**
 * JSON-LD serialization for structured data script tags. Escapes `<` so a
 * value containing "</script>" can never break out of the tag.
 */
export function jsonLd(data: object): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
