import { NextResponse } from "next/server";
import { authApi } from "@/lib/api";
import { queryApiCards } from "@/lib/api-query";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const ctx = await authApi(req);
  if (ctx instanceof NextResponse) return ctx;
  return queryApiCards(req, ctx, { mine: true });
}
