// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  accounts,
  priorities,
  cardComments,
  cardActivity,
  users,
  attachments,
  cards,
} from "@/lib/db/schema";
import { apiError, parseApiId } from "@/lib/api";
import { resolveApiBoard, resolveApiCard } from "@/lib/api-access";
import { canManageBoard, getBoardMemberUsers } from "@/lib/authz";
import { getVisibleFieldKeys } from "@/lib/board-fields";
import { pagination } from "@/lib/api-query";
import { sanitizeMultiLine } from "@/lib/text";
import { readLimitedBody } from "@/lib/public-api";
import {
  absPath,
  contentDisposition,
  deleteStoredFile,
  saveAntragFile,
  validateUpload,
} from "@/lib/attachments";
import {
  isCardAttachmentVisible,
  CARD_ATTACHMENT_FIELD,
} from "@/lib/card-attachment-visibility";
import {
  AUSWEIS_MIME,
  PDF_MIME,
  MAX_UPLOAD_BYTES,
  type AttachmentKind,
} from "@/lib/constants";

export async function apiJson(req: Request, max = 1000000): Promise<unknown> {
  const result = await readLimitedBody(req, max);
  if (!result.ok) return undefined;
  try {
    return JSON.parse(new TextDecoder().decode(result.body));
  } catch {
    return undefined;
  }
}
export async function boardCatalog(
  req: Request,
  id: string,
  kind: "users" | "accounts" | "priorities",
) {
  const r = await resolveApiBoard(req, id);
  if (r instanceof NextResponse) return r;
  const visible = await getVisibleFieldKeys(r.board.id);
  if (kind === "users") {
    if (!visible.has("assignee") && !visible.has("creator"))
      return apiError(400, "Nutzerfelder sind auf diesem Board deaktiviert.");
    const p = pagination(req),
      q =
        new URL(req.url).searchParams.get("q")?.trim().toLocaleLowerCase() ??
        "";
    if (!p.success || q.length > 200)
      return apiError(400, "Ungültige Suchparameter.");
    const all = (await getBoardMemberUsers(r.board))
      .filter(
        (u) =>
          !q || `${u.name ?? ""} ${u.username}`.toLocaleLowerCase().includes(q),
      )
      .sort((a, b) => a.id - b.id);
    const { limit, offset } = p.data;
    return NextResponse.json({
      users: all
        .slice(offset, offset + limit)
        .map((u) => ({ id: u.id, username: u.username, name: u.name })),
      pagination: { limit, offset, hasMore: all.length > offset + limit },
    });
  }
  if (!visible.has(kind === "accounts" ? "account" : "priority"))
    return apiError(400, "Dieses Feld ist auf dem Board deaktiviert.");
  return NextResponse.json(
    kind === "accounts"
      ? {
          accounts: await db
            .select({
              id: accounts.id,
              name: accounts.name,
              position: accounts.position,
            })
            .from(accounts)
            .orderBy(asc(accounts.position), asc(accounts.id)),
        }
      : {
          priorities: await db
            .select({
              id: priorities.id,
              label: priorities.label,
              color: priorities.color,
              position: priorities.position,
            })
            .from(priorities)
            .orderBy(asc(priorities.position), asc(priorities.id)),
        },
  );
}

export const commentSchema = z
  .object({
    body: z
      .string()
      .transform(sanitizeMultiLine)
      .pipe(z.string().min(1).max(5000)),
  })
  .strict();
export async function commentsApi(
  req: Request,
  id: string,
  commentId?: string,
) {
  const r = await resolveApiCard(req, id, req.method !== "GET");
  if (r instanceof NextResponse) return r;
  if (req.method === "GET") {
    const p = pagination(req);
    if (!p.success) return apiError(400, "Ungültige Pagination.");
    const { limit, offset } = p.data;
    const rows = await db
      .select({
        id: cardComments.id,
        body: cardComments.body,
        userId: cardComments.userId,
        authorName: users.name,
        authorUsername: users.username,
        createdAt: cardComments.createdAt,
      })
      .from(cardComments)
      .leftJoin(users, eq(users.id, cardComments.userId))
      .where(eq(cardComments.cardId, r.card.id))
      .orderBy(desc(cardComments.id))
      .limit(limit + 1)
      .offset(offset);
    return NextResponse.json({
      comments: rows.slice(0, limit),
      pagination: { limit, offset, hasMore: rows.length > limit },
    });
  }
  const parsed =
    req.method === "DELETE"
      ? null
      : commentSchema.safeParse(await apiJson(req, 40000));
  if (parsed && !parsed.success)
    return apiError(400, "Kommentar muss 1 bis 5000 Zeichen enthalten.");
  if (req.method === "POST" && parsed?.success) {
    const [comment] = await db
      .insert(cardComments)
      .values({
        cardId: r.card.id,
        userId: r.ctx.user.id,
        body: parsed.data.body,
      })
      .returning();
    return NextResponse.json({ comment }, { status: 201 });
  }
  const cid = parseApiId(commentId ?? "");
  if (!cid) return apiError(404, "Kommentar nicht gefunden.");
  const [comment] = await db
    .select()
    .from(cardComments)
    .where(and(eq(cardComments.id, cid), eq(cardComments.cardId, r.card.id)));
  if (!comment) return apiError(404, "Kommentar nicht gefunden.");
  // Editing is author-only; deletion follows the existing author/board-manager rule.
  if (
    comment.userId !== r.ctx.user.id &&
    (req.method !== "DELETE" || !canManageBoard(r.ctx.user, r.board))
  )
    return apiError(403, "Keine Berechtigung für diesen Kommentar.");
  if (req.method === "DELETE") {
    await db
      .delete(cardComments)
      .where(and(eq(cardComments.id, cid), eq(cardComments.cardId, r.card.id)));
    return NextResponse.json({ ok: true });
  }
  if (!parsed?.success) return apiError(400, "Ungültiger Kommentar.");
  const [updated] = await db
    .update(cardComments)
    .set({ body: parsed.data.body })
    .where(
      and(eq(cardComments.id, cid), eq(cardComments.userId, r.ctx.user.id)),
    )
    .returning();
  return updated
    ? NextResponse.json({ comment: updated })
    : apiError(404, "Kommentar nicht gefunden.");
}

export async function activityApi(req: Request, id: string) {
  const r = await resolveApiCard(req, id);
  if (r instanceof NextResponse) return r;
  const p = pagination(req);
  if (!p.success) return apiError(400, "Ungültige Pagination.");
  const { limit, offset } = p.data;
  const visible = await getVisibleFieldKeys(r.board.id);
  const rows = await db
    .select()
    .from(cardActivity)
    .where(eq(cardActivity.cardId, r.card.id))
    .orderBy(desc(cardActivity.id))
    .limit(limit + 1)
    .offset(offset);
  // Legacy details contain filenames, archive paths, and historical hidden values.
  // Never forward those unstructured strings for file/archive/unknown events.
  const labels: Record<string, string> = {
    attachment_added: "Datei hinzugefügt",
    attachment_removed: "Datei entfernt",
    archive: "Archivierung abgeschlossen",
    archive_failed: "Archivierung fehlgeschlagen",
  };
  const activity = rows.slice(0, limit).map((row) => ({
    id: row.id,
    userId: row.userId,
    type: row.type,
    createdAt: row.createdAt,
    detail:
      row.type === "status" || row.type === "created"
        ? row.detail
        : row.type === "assignee"
          ? visible.has("assignee")
            ? row.detail
            : null
          : row.type === "deadline"
            ? visible.has("deadline")
              ? row.detail
              : null
            : (labels[row.type] ?? null),
  }));
  return NextResponse.json({
    activity,
    pagination: { limit, offset, hasMore: rows.length > limit },
  });
}

function attachmentMetadata(a: typeof attachments.$inferSelect) {
  return {
    id: a.id,
    cardId: a.cardId,
    kind: a.kind,
    filename: a.filename,
    mime: a.mime,
    size: a.size,
    uploadedAt: a.uploadedAt,
    uploadedBy: a.uploadedBy,
    downloadPath: `/api/v1/cards/${a.cardId}/attachments/${a.id}`,
  };
}

/** Shared file writer. Disk operations happen outside the card lock. */
export async function storeApiAttachment(
  cardId: number,
  userId: number,
  kind: AttachmentKind,
  file: File,
) {
  const saved = await saveAntragFile(cardId, file);
  const oldPaths: string[] = [];
  let result: typeof attachments.$inferSelect;
  try {
    result = await db.transaction(async (tx) => {
      const [card] = await tx
        .select({ id: cards.id })
        .from(cards)
        .where(eq(cards.id, cardId))
        .for("update");
      if (!card) throw new Error("Card removed");
      let folderId: number | null = null;
      if (kind !== "other") {
        const old = await tx
          .delete(attachments)
          .where(
            and(eq(attachments.cardId, cardId), eq(attachments.kind, kind)),
          )
          .returning({ path: attachments.path, folderId: attachments.folderId });
        folderId = old[0]?.folderId ?? null;
        oldPaths.push(...old.map((a) => a.path));
      }
      const [att] = await tx
        .insert(attachments)
        .values({
          cardId,
          kind,
          filename: saved.filename,
          folderId,
          path: saved.relPath,
          mime: saved.mime,
          size: saved.size,
          uploadedBy: userId,
        })
        .returning();
      await tx
        .update(cards)
        .set({ updatedAt: new Date() })
        .where(eq(cards.id, cardId));
      await tx.insert(cardActivity).values({
        cardId,
        userId,
        type: "attachment_added",
        detail: `Datei hinzugefügt: ${saved.filename}`,
      });
      return att;
    });
  } catch (e) {
    await deleteStoredFile(saved.relPath);
    throw e;
  }
  for (const path of oldPaths) await deleteStoredFile(path);
  return result;
}

export async function resolveApiAttachment(req: Request, id: string, attachmentId: string) {
  const r = await resolveApiCard(req, id);
  if (r instanceof NextResponse) return r;
  const aid = parseApiId(attachmentId);
  if (!aid) return apiError(404, "Anhang nicht gefunden.");
  const [attachment] = await db.select().from(attachments)
    .where(and(eq(attachments.id, aid), eq(attachments.cardId, r.card.id)));
  const visible = await getVisibleFieldKeys(r.board.id);
  if (!attachment || !isCardAttachmentVisible(attachment, visible))
    return apiError(404, "Anhang nicht gefunden.");
  return { ...r, attachment };
}

export async function attachmentsApi(
  req: Request,
  id: string,
  attachmentId?: string,
) {
  if (req.method === "GET" && attachmentId) {
    const resolved = await resolveApiAttachment(req, id, attachmentId);
    if (resolved instanceof NextResponse) return resolved;
    const a = resolved.attachment;
    try {
      const data = await readFile(absPath(a.path));
      return new Response(new Uint8Array(data), {
        headers: {
          "Content-Type": a.mime,
          "Content-Disposition": contentDisposition(a.filename),
          "Content-Length": String(data.length),
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return apiError(404, "Datei nicht gefunden.");
    }
  }
  const r = await resolveApiCard(req, id, req.method === "POST");
  if (r instanceof NextResponse) return r;
  const visible = await getVisibleFieldKeys(r.board.id);
  if (req.method === "POST") {
    const raw = await readLimitedBody(req, MAX_UPLOAD_BYTES + 65536);
    if (!raw.ok)
      return apiError(
        raw.reason === "too_large" ? 413 : 400,
        "Upload zu groß oder unlesbar.",
      );
    let data: FormData;
    try {
      data = await new Request(req.url, {
        method: "POST",
        headers: { "content-type": req.headers.get("content-type") ?? "" },
        body: raw.body,
      }).formData();
    } catch {
      return apiError(
        400,
        "multipart/form-data mit file und kind erforderlich.",
      );
    }
    if (
      [...data.keys()].some((k) => k !== "file" && k !== "kind") ||
      data.getAll("file").length !== 1 ||
      data.getAll("kind").length !== 1
    )
      return apiError(400, "Genau file und kind erforderlich.");
    const kind = z
      .enum(["finance_request", "annex_a", "annex_b", "student_card", "other"])
      .safeParse(data.get("kind"));
    const file = data.get("file");
    if (!kind.success || !(file instanceof File))
      return apiError(400, "Ungültige Datei oder Kategorie.");
    if (!visible.has(CARD_ATTACHMENT_FIELD[kind.data]))
      return apiError(400, "Anhangfeld ist deaktiviert.");
    const error = validateUpload(
      file,
      kind.data === "student_card" ? AUSWEIS_MIME : PDF_MIME,
    );
    if (error) return apiError(400, error);
    try {
      return NextResponse.json(
        {
          attachment: attachmentMetadata(
            await storeApiAttachment(r.card.id, r.ctx.user.id, kind.data, file),
          ),
        },
        { status: 201 },
      );
    } catch {
      return apiError(
        409,
        "Upload konnte nicht gespeichert werden. Karte erneut laden.",
      );
    }
  }
  const p = pagination(req);
  if (!p.success) return apiError(400, "Ungültige Pagination.");
  const all = (
    await db
      .select()
      .from(attachments)
      .where(eq(attachments.cardId, r.card.id))
      .orderBy(asc(attachments.id))
  ).filter((a) => isCardAttachmentVisible(a, visible));
  const { limit, offset } = p.data;
  return NextResponse.json({
    attachments: all.slice(offset, offset + limit).map(attachmentMetadata),
    pagination: { limit, offset, hasMore: all.length > offset + limit },
  });
}
