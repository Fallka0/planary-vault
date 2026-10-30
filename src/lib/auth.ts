export const AUTH_BASE_URL = process.env.NEXT_PUBLIC_AUTH_BASE_URL || "https://auth.planary.ch";
export const PLANARY_URL = process.env.NEXT_PUBLIC_PLANARY_URL || "https://planary.ch";
export const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL || "https://portal.planary.ch";

/** `auto` = single sign-on: an existing Planary session comes straight back without a click. */
export function buildAuthUrl(mode: "login" | "signup", returnTo: string, auto = false) {
  const target = new URL(mode === "signup" ? "/signup" : "/", AUTH_BASE_URL);
  target.searchParams.set("returnTo", returnTo);
  if (auto) target.searchParams.set("auto", "1");
  return target.toString();
}

export function signOutUrl() {
  const target = new URL("/logout", AUTH_BASE_URL);
  target.searchParams.set("returnTo", PLANARY_URL);
  return target.toString();
}

/** Name, email and two-factor all live in the Planary account. */
export const ACCOUNT_URL = `${AUTH_BASE_URL}/account`;
export const PRICING_URL = `${PLANARY_URL}/vault/pricing`;
/** Invoices, payment method and billing contact, for every Planary product. */
export const BILLING_URL = `${PORTAL_URL}/abrechnung`;
export const PRODUCT_URL = `${PLANARY_URL}/vault`;
