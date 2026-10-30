"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { buildAuthUrl, signOutUrl } from "@/lib/auth";
import { absorbSessionFromHash, clearSession, loadSession, verifySession } from "@/lib/session";
import { configureApi, forgetDevice } from "@/lib/api";
import { setUploadToken } from "@/lib/files";
import { Curtain } from "./Curtain";

export interface PlanaryUser {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: PlanaryUser;
  accessToken: string;
  signOut: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/** Vault has no login screen. Without a session we hop to planary-auth, which sends
 *  already-signed-in people straight back (single sign-on), so this is usually invisible. */
function goSignIn() {
  window.location.replace(buildAuthUrl("login", window.location.href.split("#")[0], true));
}

function signOut() {
  clearSession();
  // End the Planary session too, or single sign-on would put the person straight back in.
  window.location.assign(signOutUrl());
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<{ user: PlanaryUser; accessToken: string } | null>(null);

  useEffect(() => {
    let active = true;
    const stored = absorbSessionFromHash() ?? loadSession();
    if (!stored) {
      goSignIn();
      return;
    }
    configureApi(stored.accessToken, () => {
      // Either the token ran out or this device was signed out from Settings on another one.
      clearSession();
      goSignIn();
    });
    setUploadToken(stored.accessToken);
    // The session lives in this browser's storage, which only exists after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession({ user: { id: stored.userId, email: stored.email, name: stored.name }, accessToken: stored.accessToken });

    void verifySession(stored).then((ok) => {
      if (!active || ok) return;
      clearSession();
      goSignIn();
    });
    // Tokens last an hour; fetch a fresh one the same silent way shortly before that.
    // Key material lives only in memory, so this reload also locks the vault.
    const timer = window.setTimeout(
      () => {
        clearSession();
        goSignIn();
      },
      Math.max(0, stored.expiresAt * 1000 - Date.now() - 60_000),
    );
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, []);

  const handleSignOut = useCallback(() => {
    forgetDevice();
    signOut();
  }, []);

  if (!session) return <Curtain state="hold" />;

  return <AuthContext.Provider value={{ ...session, signOut: handleSignOut }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
