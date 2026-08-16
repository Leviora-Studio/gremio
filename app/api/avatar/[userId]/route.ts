// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { avatarAbsPath } from "@/lib/avatar";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  const me = await getCurrentUser();
  if (!me) return new Response("Unauthorized", { status: 401 });

  const { userId } = await params;
  const uid = Number(userId);
  if (!Number.isInteger(uid)) return new Response("Not found", { status: 404 });
  const [u] = await db
    .select({ avatarPath: users.avatarPath })
    .from(users)
    .where(eq(users.id, uid))
    .limit(1);
  if (!u?.avatarPath) return new Response("Not found", { status: 404 });

  try {
    const buf = await readFile(avatarAbsPath(u.avatarPath));
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=60",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
