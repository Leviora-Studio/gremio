"use client";
import { useId } from "react";
import { UploadQueue } from "@/components/UploadQueue";
import { usePublicUploads } from "@/components/PublicUploadScope";
import { addPublicFileAction } from "@/app/status/[token]/actions";
import type { UploadPurpose } from "@/lib/public-workflow";

export function PublicUploadForm({ token, purpose = "general" }: { token: string; purpose?: UploadPurpose }) {
  const id = useId();
  const scope = usePublicUploads();
  return <UploadQueue label={purpose === "receipt" ? "Quittungen hochladen" : "Dateien hochladen"}
    onBusy={(busy) => scope.change(id, busy)}
    upload={(file) => { const data = new FormData(); data.set("file", file); data.set("purpose", purpose); return addPublicFileAction(token, {}, data); }} />;
}
