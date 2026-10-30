import { Lockup } from "./Logo";
import { initials } from "@/lib/format";
import { ACCOUNT_URL } from "@/lib/auth";

/** Setup, unlock, settings and link pages: lockup on the left, one control on the right. */
export function FocusPage({ right, children, home = "/" }: { right?: React.ReactNode; children: React.ReactNode; home?: string }) {
  return (
    <div className="page">
      <header className="page-header">
        <Lockup href={home} />
        {right}
      </header>
      {children}
    </div>
  );
}

export function AccountPill({ name, email }: { name: string; email: string }) {
  return (
    <a className="account-pill" href={ACCOUNT_URL}>
      <span className="avatar">{initials(name || email)}</span>
      {email}
    </a>
  );
}
