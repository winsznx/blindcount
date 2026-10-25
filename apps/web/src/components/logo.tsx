export function Mark({ size = 22 }: { size?: number }) {
  // A tally whose final stroke is withheld: counting without the target.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="#173B31" />
      <rect x="6" y="6" width="2.2" height="12" rx="1.1" fill="#F7F8F4" />
      <rect x="10" y="6" width="2.2" height="12" rx="1.1" fill="#F7F8F4" />
      <rect x="14" y="6" width="2.2" height="12" rx="1.1" fill="#F7F8F4" />
      <rect x="17.4" y="6" width="2.2" height="12" rx="1.1" fill="none" stroke="#B7D5AF" strokeWidth="1" strokeDasharray="1.6 1.4" />
    </svg>
  );
}

export function Logo() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 9, fontWeight: 600, fontSize: 16.5, letterSpacing: "-0.02em", color: "var(--ink)" }}>
      <Mark />
      BlindCount
    </span>
  );
}
