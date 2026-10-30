"use client";

import { FileBrowser } from "@/components/FileBrowser";

export default function TrashPage() {
  return <FileBrowser scope={{ kind: "trash" }} />;
}
