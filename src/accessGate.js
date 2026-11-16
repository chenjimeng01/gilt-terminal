// Entry gate: visitors self-certify their status before any content loads.
// Gilt Terminal is information only and directed only at professionals; a
// visitor who selects "Other" (or nothing) is not shown the tool.
//
// This is self-certification in the browser, not an access control: it shows
// who the site is directed at and stops casual use, but it cannot verify the
// answer. The certification lasts for the browser session only, so each new
// visit certifies again.

export const STATUSES = [
  { id: "adviser",       label: "Financial Adviser",      detail: "Authorised, or working for an authorised firm, to advise on investments.", allowed: true },
  { id: "professional",  label: "Professional Investor",  detail: "A professional client, or investing in a professional capacity.", allowed: true },
  { id: "institutional", label: "Institutional Investor", detail: "Acting for a fund, pension scheme, insurer, bank or similar institution.", allowed: true },
  { id: "other",         label: "Other",                  detail: "Including private (retail) investors.", allowed: false },
];

export const GATE_KEY = "giltTerminal.certifiedStatus";

/** True only for a known, permitted status that the visitor has confirmed. */
export function mayEnter(statusId, confirmed) {
  const s = STATUSES.find(x => x.id === statusId);
  return Boolean(s && s.allowed && confirmed === true);
}

/** The certified status stored for this browser session, if still permitted. */
export function readCertified(storage) {
  try {
    const id = storage?.getItem(GATE_KEY);
    return mayEnter(id, true) ? id : null;
  } catch { return null; }
}

export function writeCertified(storage, statusId) {
  try { if (mayEnter(statusId, true)) storage?.setItem(GATE_KEY, statusId); } catch { /* storage blocked: certify each load */ }
}
