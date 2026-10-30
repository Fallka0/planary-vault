"use client";

import { AuthProvider } from "@/components/AuthProvider";
import { VaultProvider } from "@/components/VaultProvider";

/** Everything except public link pages: signed in through Planary, then unlocked with the passphrase. */
export default function VaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <VaultProvider>{children}</VaultProvider>
    </AuthProvider>
  );
}
