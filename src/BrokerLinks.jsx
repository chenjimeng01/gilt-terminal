import { brokerLinks } from "./brokerLinks.js";

const link = {
  display: "inline-block", fontSize: 10.5, fontWeight: 500, padding: "2px 7px", borderRadius: 12,
  border: "1px solid #e0deda", background: "#fff", color: "#2563a8", textDecoration: "none",
  whiteSpace: "nowrap", fontFamily: "'DM Sans', sans-serif",
};

/**
 * "HL ↗  AJ Bell ↗" for one gilt: outbound links to the brokers' own pages
 * (see brokerLinks.js). Renders nothing if the gilt has no valid ISIN.
 */
export default function BrokerLinks({ gilt }) {
  const l = brokerLinks(gilt);
  if (!l) return null;
  return (
    <span style={{ display: "inline-flex", gap: 4 }}>
      <a style={link} href={l.hl.url} title={l.hl.title} target="_blank" rel="noopener noreferrer">HL ↗</a>
      <a style={l.ajbell.listed ? link : { ...link, color: "#9a978f" }} href={l.ajbell.url} title={l.ajbell.title}
        target="_blank" rel="noopener noreferrer">AJ Bell ↗</a>
    </span>
  );
}
