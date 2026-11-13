import { lockCardApi } from "@/lib/api-application-cards";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return lockCardApi(req, (await params).id);
}
