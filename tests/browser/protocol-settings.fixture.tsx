// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ProtocolAreaConfigForm } from "../../components/protocols/ProtocolAreaConfigForm";
import { DocumentEditor } from "../../components/documents/DocumentEditor";
import { CreateSessionForm } from "../../components/protocols/CreateSessionForm";
import { CreateProtocolForm } from "../../components/protocols/CreateProtocolForm";
import { ProtocolMembersPanel } from "../../components/protocols/ProtocolMembersPanel";
import { ProtocolGuestsPanel } from "../../components/protocols/ProtocolGuestsPanel";
import { ProtocolLogoSettings } from "../../components/protocols/ProtocolLogoSettings";
import type { ProtocolMember } from "../../lib/protocol-members";

function Controls() {
  const [members, setMembers] = useState<ProtocolMember[]>([{ id: 1, name: "Anna", present: false, proxyMemberId: null }, { id: 2, name: "Ben", present: true, proxyMemberId: null }]);
  const guests = [{ id: 1, name: "Carla", affiliation: "Test", concern: "Frage" }, { id: 2, name: "Dora", affiliation: "", concern: "" }];
  const [logos, setLogos] = useState([{ id: 1, name: "Testlogo", isDefault: true }]);
  const action = async (_: unknown, data: FormData) => { Object.assign(window, { chosenDate: data.get("date") }); return { success: "Erstellt" }; };
  return <main className="mx-auto max-w-3xl space-y-8 p-4">
    <div data-test="session"><CreateSessionForm today="2026-09-04" action={action} /></div>
    <div data-test="protocol"><CreateProtocolForm date="2026-09-04" action={action} defaultTemplateId={1} templates={[{ id: 1, name: "System" }]} /></div>
    <ProtocolMembersPanel members={members} disabled={false} onBusyChange={() => {}} onChange={setMembers} action={async command => ({ members: command.type === "attendance" ? members.map(member => member.id === command.memberId ? { ...member, present: command.present, proxyMemberId: command.proxyMemberId } : member) : members })} />
    <ProtocolGuestsPanel guests={guests} disabled={false} onBusyChange={() => {}} onDirtyChange={() => {}} onChange={() => {}} action={async () => ({ guests })} />
    <ProtocolLogoSettings areaId={1} initialLogos={logos} action={async data => { if (data.get("type") === "remove") { setLogos([]); return { logos: [] }; } return { logos }; }} />
  </main>;
}
const stored = localStorage.getItem("protocol-settings");
const config = stored ? JSON.parse(stored) : undefined;
createRoot(document.getElementById("root")!).render(location.search.includes("controls") ? <Controls /> : location.search.includes("document") ? <DocumentEditor
  initialContent={"# Sitzung\n\n"} filename="Protokoll.md" contextLabel="Test" backHref="#" saveAction={async content => { Object.assign(window, { savedDocument: content }); return { content, savedToNextcloud: true }; }} reloadAction={async () => ({ content: "# Sitzung\n\n" })}
  protocol={{ areaId: 1, members: [], guests: [], logos: [], hasLinkedBoard: true, decisionTemplate: config?.decisionTemplateEnabled ? config.decisionTemplateMarkdown : "", cardBaseUrl: "https://example.invalid/intern/card",
    suggestions: [{ id: 42, title: "Sommerfest", number: "A-42", applicant: "Anna", amount: 12000, priority: null, assignedSession: null, fields: config?.financeFields.filter((field: { enabled: boolean }) => field.enabled).map((field: { key: string }) => ({ key: field.key, label: field.key === "budget_title" ? "Haushaltstitel" : "Antragsteller", value: field.key === "budget_title" ? "0201" : "Anna" })) ?? [] }],
    memberAction: async () => ({ members: [] }), guestAction: async () => ({ guests: [] }), exportAction: async () => ({}),
  }} /> : <main className="mx-auto max-w-4xl p-4"><ProtocolAreaConfigForm initial={config}
  templates={[{ id: 1, name: "Systemvorlage" }]}
  boards={[{ id: 10, name: "Board A", statuses: [{ id: 11, name: "Geplant" }], fields: ["applicant", "budget_title", "notes", "finance_request", "created_at", "updated_at"] }, { id: 20, name: "Board B", statuses: [{ id: 21, name: "Eingang" }], fields: ["number"] }]}
  action={async (_, data) => {
    const value = Object.fromEntries(data);
    const parsed = { ...value, templateId: value.templateId === "custom" ? null : Number(value.templateId), financeFields: JSON.parse(String(value.financeFields)), boardId: Number(value.boardId) || null, sourceStatusId: Number(value.sourceStatusId) || null, decisionTemplateEnabled: value.decisionTemplateEnabled === "on" };
    localStorage.setItem("protocol-settings", JSON.stringify(parsed)); Object.assign(window, { savedSettings: parsed }); return { success: "Gespeichert" };
  }} /></main>);
