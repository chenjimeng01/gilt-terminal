// Links from a gilt to the two DIY brokers' own pages, where the user can see
// the broker's price and place a trade themselves. Gilt Terminal shows no
// broker data: these are plain outbound links.
//
// Both brokers address a gilt by its SEDOL, which is characters 5–11 of a GB
// ISIN. Checked on 2026-11-16:
//  - Hargreaves Lansdown: /shares/shares-search-results/{SEDOL} redirects to
//    the gilt's public page (15-minute delayed price, "Deal now" button). All
//    67 unmatured gilts resolved to the right page.
//  - AJ Bell has no public page per gilt. Its gilt price list
//    (/investment/bonds/gilts/prices) links each gilt to
//    /platform/trade?marketCode=SEDOL:{SEDOL}&instruction=B, the dealing
//    screen, which needs a login. 64 of the 67 were on that list; the rest
//    link to the price list itself.

export const HL_GILT_URL = "https://www.hl.co.uk/shares/shares-search-results/";
export const AJBELL_DEAL_URL = "https://www.ajbell.co.uk/platform/trade";
export const AJBELL_GILTS_URL = "https://www.ajbell.co.uk/investment/bonds/gilts/prices";
export const LINKS_CHECKED = "2026-11-16";

// Not on AJ Bell's online gilt list when checked (LINKS_CHECKED).
const AJBELL_UNLISTED = new Set([
  "GB00BQC82C90", // 4¼% Treasury Gilt 2034
  "GB00BVP99566", // 4% Treasury Gilt 2029 (May)
  "GB00BVP99673", // 4 1/8% Treasury Gilt 2031
]);

/** ISIN check digit (Luhn over the letter-expanded digits). */
export function isValidIsin(isin) {
  if (typeof isin !== "string" || !/^[A-Z]{2}[A-Z0-9]{9}\d$/.test(isin)) return false;
  const digits = [...isin].map(ch => (/\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55))).join("");
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** SEDOL from a GB ISIN (GB00 + 7-character SEDOL + check digit), else null. */
export function sedolFromIsin(isin) {
  return isValidIsin(isin) && isin.startsWith("GB00") ? isin.slice(4, 11) : null;
}

/**
 * { hl: {url, title}, ajbell: {url, title, listed} } for a gilt, or null if it
 * has no valid ISIN (no link is better than a wrong one).
 */
export function brokerLinks(gilt) {
  const sedol = sedolFromIsin(gilt?.isin);
  if (!sedol) return null;
  const listed = !AJBELL_UNLISTED.has(gilt.isin);
  return {
    hl: {
      url: HL_GILT_URL + sedol,
      title: `${gilt.name} on Hargreaves Lansdown — price (delayed 15 min) and Deal button. ISIN ${gilt.isin}.`,
    },
    ajbell: {
      listed,
      url: listed
        ? `${AJBELL_DEAL_URL}?marketCode=SEDOL:${sedol}&instruction=B`
        : AJBELL_GILTS_URL,
      title: listed
        ? `${gilt.name} on AJ Bell — opens its dealing screen (login needed). ISIN ${gilt.isin}.`
        : `${gilt.name} wasn't on AJ Bell's online gilt list when checked (${LINKS_CHECKED}) — opens the list. ISIN ${gilt.isin}.`,
    },
  };
}
