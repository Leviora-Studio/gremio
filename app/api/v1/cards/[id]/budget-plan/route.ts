import { budgetPlanApi } from "@/lib/api-application-cards";
export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return budgetPlanApi(req, (await params).id);
}
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return budgetPlanApi(req, (await params).id);
}
