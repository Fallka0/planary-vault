"use client";

import { useParams } from "next/navigation";
import { FileBrowser } from "@/components/FileBrowser";

export default function FolderPage() {
  const { id } = useParams<{ id: string }>();
  return <FileBrowser scope={{ kind: "folder", id }} />;
}
