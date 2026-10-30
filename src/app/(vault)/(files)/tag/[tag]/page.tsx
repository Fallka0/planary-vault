"use client";

import { useParams } from "next/navigation";
import { FileBrowser } from "@/components/FileBrowser";

export default function TagPage() {
  const { tag } = useParams<{ tag: string }>();
  return <FileBrowser scope={{ kind: "tag", tag: decodeURIComponent(tag) }} />;
}
