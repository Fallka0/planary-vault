"use client";

import { FileBrowser } from "@/components/FileBrowser";

export default function RecentPage() {
  return <FileBrowser scope={{ kind: "recent" }} />;
}
