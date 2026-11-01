// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { notFound } from "next/navigation";
import { canEditInventoryBoard, requireInventoryBoardAccess } from "@/lib/inventory";
import { getVisibleInventoryFieldKeys } from "@/lib/inventory-fields";
import { maskHiddenInventoryFields } from "@/lib/inventory-field-projection";
import {
  getInventoryItemById,
  getInventoryItemView,
  getInventoryNumbering,
  getInventoryOptions,
  listInventoryGroupNames,
} from "@/lib/inventory-items";
import { listDefects, listLoans } from "@/lib/inventory-loans";
import { listInventoryAttachments } from "@/lib/inventory-attachments";
import { ItemDetail } from "@/components/inventory/ItemDetail";

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
  const canEdit = await canEditInventoryBoard(user, board);

  const [
    view,
    options,
    visible,
    numbering,
    loans,
    defects,
    attachments,
    groupNames,
  ] = await Promise.all([
    getInventoryItemView(id),
    getInventoryOptions(board.id),
    getVisibleInventoryFieldKeys(board.id),
    getInventoryNumbering(board.id),
    listLoans(id),
    listDefects(id),
    listInventoryAttachments(id),
    listInventoryGroupNames(board.id),
  ]);
  if (!view) notFound();

  const toOpts = (rows: { id: number; name: string }[]) =>
    rows.map((r) => ({ id: r.id, name: r.name }));

  return (
    <>
      <ItemDetail
        canEdit={canEdit}
        item={maskHiddenInventoryFields(view, visible)}
      boardName={board.name}
      visibleFields={Array.from(visible)}
      options={{
        category: visible.has("category") ? toOpts(options.category) : [],
        location: visible.has("location") ? toOpts(options.location) : [],
        loan_status: toOpts(options.loan_status),
      }}
        groupNames={visible.has("group") ? groupNames : []}
        numberingEnabled={numbering?.enabled ?? false}
        loans={canEdit ? loans : loans.map(loan => ({ ...loan, token: null }))}
        defects={defects}
        attachments={attachments}
        hasCert={!!user.certSubject}
      />
    </>
  );
}
