"use client";

import { FileBrowser } from "@/components/FileBrowser";

export default function SharedPage() {
  return <FileBrowser scope={{ kind: "shared" }} />;
}
