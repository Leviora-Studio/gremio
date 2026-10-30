// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { KanbanBoard, type KanbanCard } from "../../components/kanban/KanbanBoard";
import { todayInBerlin } from "../../lib/dates";

const month = todayInBerlin().slice(0, 7);
const cards: KanbanCard[] = [
  { id: 1, statusId: 10, title: "Sommerfest", number: "A-2", applicant: "Erika", priorityId: 1, resubmitted: false, deadline: `${month}-05`, meeting: `${month}-12`, assignees: [{ id: 1, name: "Anna", avatarPath: null }], fields: { approved_amount: 900, account: "Testkonto" }, searchText: "sommerfest erika anna a-2" },
  { id: 2, statusId: 10, title: "Materialkosten", number: "A-10", applicant: "Max", priorityId: null, resubmitted: true, deadline: `${month}-15`, meeting: null, assignees: [], fields: { approved_amount: 12000, account: "Testkonto" }, searchText: "materialkosten max a-10" },
  { id: 3, statusId: 20, title: "Ohne Termin", number: null, applicant: "Test", priorityId: null, resubmitted: false, deadline: null, meeting: null, assignees: [], fields: { approved_amount: null }, searchText: "ohne termin test" },
];
function Fixture() {
  const searchNavigation = location.search.includes("search-navigation");
  const [items, setItems] = useState(() => cards.map(card => searchNavigation && card.id === 1 ? { ...card, deadline: "2031-03-12" } : card));
  const office = location.search.includes("office");
  const restricted = location.search.includes("restricted");
  useEffect(() => {
    const listener = (event: Event) => {
      const { cardId, statusId, orderedIds } = (event as CustomEvent).detail;
      Object.assign(window, { lastMove: { cardId, statusId, orderedIds } });
      setItems(previous => previous.map(card => card.id === cardId ? { ...card, statusId, resubmitted: false } : card));
    };
    window.addEventListener("fixture-move", listener);
    return () => window.removeEventListener("fixture-move", listener);
  }, []);
  return <KanbanBoard canEdit={!office} officeMoveRules={office ? { sourceStatusIds: [10], targetStatusIds: [20] } : null} preferenceKey={`fixture:${restricted}`} cards={items} statuses={[...(searchNavigation ? Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, name: `Vorherige Spalte ${i}`, isArchiveTrigger: false })) : []), { id: 10, name: "Eingegangen", isArchiveTrigger: false }, { id: 20, name: "Angenommen", isArchiveTrigger: false }, { id: 30, name: "Leer", isArchiveTrigger: false }]}
    visible={restricted ? ["number"] : ["number", "applicant", "assignee", "priority", "deadline", "meeting", "approved_amount", "account"]}
    priorities={[{ id: 1, label: "Hoch", color: "red" }]} members={[{ id: 1, username: "anna", name: "Anna", avatarPath: null }]} />;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
