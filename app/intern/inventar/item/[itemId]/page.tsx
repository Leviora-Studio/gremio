// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

import { notFound } from "next/navigation";
import { requireInventoryBoardAccess } from "@/lib/inventory";
import { getVisibleInventoryFieldKeys } from "@/lib/inventory-fields";
import {
  getInventoryItemById,
  getInventoryItemView,
  getInventoryNumbering,
  getInventoryOptions,
} from "@/lib/inventory-items";
import { listDefects, listLoans } from "@/lib/inventory-loans";
import { listInventoryAttachments } from "@/lib/inventory-attachments";
import { ItemDetail } from "@/components/inventory/ItemDetail";
import { LiveRefresh } from "@/components/LiveRefresh";

export default async function InventoryItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = await params;
  const id = Number(itemId);
  const item = await getInventoryItemById(id);
  if (!item) notFound();
  const { user, board } = await requireInventoryBoardAccess(item.boardId);

  const [view, options, visible, numbering, loans, defects, attachments] =
    await Promise.all([
      getInventoryItemView(id),
      getInventoryOptions(board.id),
      getVisibleInventoryFieldKeys(board.id),
      getInventoryNumbering(board.id),
      listLoans(id),
      listDefects(id),
      listInventoryAttachments(id),
    ]);
  if (!view) notFound();

  const toOpts = (rows: { id: number; name: string }[]) =>
    rows.map((r) => ({ id: r.id, name: r.name }));

  return (
    <>
      <LiveRefresh src={`/api/inventory/board/${board.id}/stream`} />
      <ItemDetail
        item={view}
      boardName={board.name}
      visibleFields={Array.from(visible)}
      options={{
        category: toOpts(options.category),
        location: toOpts(options.location),
        loan_status: toOpts(options.loan_status),
      }}
        numberingEnabled={numbering?.enabled ?? false}
        loans={loans}
        defects={defects}
        attachments={attachments}
        hasCert={!!user.certSubject}
      />
    </>
  );
}
