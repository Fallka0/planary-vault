import { useId } from "react";
import Link from "next/link";

/** The planet mark from planary.ch. Mask ids are per instance so it can render twice on a page. */
export function PlanetMark({ className }: { className?: string }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg viewBox="0 0 100 100" fill="none" aria-hidden="true" className={className}>
      <defs>
        <mask id={`${id}-cut`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <path d="M6 50A44 12.5 0 0 0 94 50" transform="rotate(-28 50 50)" stroke="#000" strokeWidth="11" />
        </mask>
        <mask id={`${id}-back`} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
          <rect width="100" height="100" fill="#fff" />
          <circle cx="50" cy="50" r="28" fill="#000" />
        </mask>
      </defs>
      <circle cx="50" cy="50" r="25" fill="currentColor" mask={`url(#${id}-cut)`} />
      <path
        d="M94 50A44 12.5 0 0 0 6 50"
        transform="rotate(-28 50 50)"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        mask={`url(#${id}-back)`}
      />
      <path d="M6 50A44 12.5 0 0 0 94 50" transform="rotate(-28 50 50)" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

/** [planet mark] Planary │ Vault */
export function Lockup({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="lockup" aria-label="Planary Vault">
      <PlanetMark className="lockup-mark" />
      <span className="lockup-word">Planary</span>
      <span className="lockup-app">Vault</span>
    </Link>
  );
}
