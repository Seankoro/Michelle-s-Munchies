/**
 * Singapore mobile-number validation + normalization.
 *
 * SG mobile numbers are 8 digits starting with 8 or 9 (6 is a landline prefix),
 * optionally written with a +65 / 65 country code and spaces or dashes. We accept
 * those forms and normalize to a consistent "+65 XXXX XXXX".
 */
const SG_LOCAL_RE = /^[89]\d{7}$/;

/** Reduce any accepted form to its 8-digit local number, or null if invalid. */
function toLocalDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  // Drop a leading 65 country code only when it leaves a full 8-digit number.
  const local = digits.length === 10 && digits.startsWith("65") ? digits.slice(2) : digits;
  return SG_LOCAL_RE.test(local) ? local : null;
}

export function isValidSgPhone(input: string): boolean {
  return toLocalDigits(input) !== null;
}

/** Returns "+65 XXXX XXXX", or null if the input is not a valid SG mobile. */
export function normalizeSgPhone(input: string): string | null {
  const local = toLocalDigits(input);
  if (!local) return null;
  return `+65 ${local.slice(0, 4)} ${local.slice(4)}`;
}
