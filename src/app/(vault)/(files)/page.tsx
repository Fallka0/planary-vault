"use client";

import { FileBrowser } from "@/components/FileBrowser";

export default function AllPage() {
  return <FileBrowser scope={{ kind: "all" }} />;
}
