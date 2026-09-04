// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { createRoot } from "react-dom/client";
import Page from "../../app/intern/protokolle/[id]/sitzung/[sessionId]/page";

const root = createRoot(document.getElementById("root"));
window.folder = "";
window.uploads = [];
window.created = [];
window.openedDocument = null;
window.syncs = [];
window.renderFolder = async (folder = window.folder) => {
  window.folder = folder;
  root.render(await Page({ params: Promise.resolve({ id: "2", sessionId: "3" }), searchParams: Promise.resolve({ folder }) }));
};
document.addEventListener("click", event => {
  const link = event.target.closest("a");
  if (!link?.getAttribute("href")?.startsWith("/intern/protokolle/2/sitzung/3")) return;
  event.preventDefault();
  window.renderFolder(new URL(link.getAttribute("href"), "https://example.invalid").searchParams.get("folder") ?? "");
});
window.renderFolder();
