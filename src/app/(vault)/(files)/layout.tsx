"use client";

import { AppShell } from "@/components/AppShell";

/** The sidebar, search and upload queue stay mounted while you move between folders. */
export default function FilesLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
