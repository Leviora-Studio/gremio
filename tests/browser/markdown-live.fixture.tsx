// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import React from "react";
import { createRoot } from "react-dom/client";
import { DocumentEditor } from "../../components/documents/DocumentEditor";

const initialContent = "# Sitzung\n\nEin einfacher Absatz.";
const saved: { text: string; planned?: number[] }[] = [];
const protocolMode = location.search.includes("protocol");
const imageMode = location.search.includes("images");
const imageUploads: string[] = [];
Object.assign(window, { saved, imageUploads });
createRoot(document.getElementById("root")!).render(
  <DocumentEditor filename={protocolMode ? "Protokoll.md" : "Notizen.md"} initialContent={initialContent} backHref="#folder"
    contextLabel="Browser fixture"
    saveAction={async (text, planned) => { saved.push({ text, planned }); return { savedToNextcloud: true, content: text }; }}
    reloadAction={async () => {
      if (location.search.includes("slow-reload")) await new Promise<void>(resolve => Object.assign(window, { releaseReload: resolve }));
      return { content: initialContent };
    }}
    images={imageMode ? { areaId: 2, sessionId: 3, subfolder: "Anlagen", uploadAction: async data => {
      const file = data.get("file") as File;
      imageUploads.push(file.name);
      if (file.name === "bad.png") return { error: "Test-Upload fehlgeschlagen" };
      await new Promise<void>(resolve => Object.assign(window, { releaseImageUpload: resolve }));
      return { reference: "attachments/Testbild.png", alt: "Testbild" };
    } } : undefined}
    protocol={protocolMode ? {
      areaId: 1, members: [], guests: [], suggestions: [{ id: 7, number: "FA 7", title: "Testantrag", applicant: "Antragsteller Test", amount: 12500, priority: null, assignedSession: "Sitzung September" }], hasLinkedBoard: true, cardBaseUrl: "https://example.invalid/intern/card", logos: [],
      resultProtocol: { href: "#result", exists: false },
      memberAction: async () => ({ members: [] }), guestAction: async () => ({ guests: [] }), exportAction: async () => ({ success: "PDF gespeichert" }),
    } : undefined} />
);
