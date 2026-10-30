// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { and, eq, isNull, sql } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { boards, locations, feedbackAreas, inventoryBoards, smtpSettings, emailConfirmationSettings, emailOutbox } from "@/lib/db/schema";
import { SmtpSettingsForm } from "@/components/admin/SmtpSettingsForm";
import { SubmitButton } from "@/components/SubmitButton";
import { saveEmailConfirmationAction, retryFailedEmailsAction } from "./actions";
export default async function EmailAdminPage() {
  await requireAdmin();
  const [config] = await db.select().from(smtpSettings).where(eq(smtpSettings.id, 1));
  const settings = await db.select().from(emailConfirmationSettings);
  const publicApplications = await db.selectDistinct({id:boards.id,name:boards.name}).from(boards).innerJoin(locations,eq(locations.targetBoardId,boards.id)).where(and(eq(locations.enabled,true),isNull(boards.inventoryBoardId)));
  const publicFeedback = await db.selectDistinct({id:boards.id,name:boards.name}).from(boards).innerJoin(feedbackAreas,eq(feedbackAreas.targetBoardId,boards.id)).where(and(eq(feedbackAreas.enabled,true),isNull(boards.inventoryBoardId)));
  const publicInventories = await db.select({id:inventoryBoards.id,name:inventoryBoards.name}).from(inventoryBoards).where(eq(inventoryBoards.isPublic,true));
  const counts = await db.select({state:emailOutbox.state,count:sql<number>`count(*)::int`}).from(emailOutbox).groupBy(emailOutbox.state);
  return <div className="mx-auto max-w-5xl space-y-6">
    <section className="card space-y-4 p-5"><h2 className="text-xl font-semibold">SMTP-Einstellungen der Instanz</h2>
      <SmtpSettingsForm initial={{enabled:config?.enabled ?? false,host:config?.host ?? "",port:config?.port ?? 587,security:config?.security ?? "starttls",username:config?.username ?? null,hasPassword:!!config?.passwordEnc,fromEmail:config?.fromEmail ?? "",fromName:config?.fromName ?? "Gremio",replyTo:config?.replyTo ?? null}} />
    </section>
    <section className="card space-y-4 p-5"><h2 className="text-xl font-semibold">Empfangsbestätigungen für öffentliche Anträge</h2>
      <p className="text-sm text-slate-500">Bei Aktivierung erhält die einreichende Person eine E-Mail mit persönlichem Status-Link und Bestätigungs-PDF. Der instanzweite SMTP-Versand muss ebenfalls aktiviert sein. Ohne Haken wird keine Empfangsbestätigung versendet.</p>
      {([{kind:"application",title:"Finanzanträge",rows:publicApplications},{kind:"feedback",title:"Feedback",rows:publicFeedback},{kind:"inventory",title:"Inventaranfragen",rows:publicInventories}] as const).map(group => <div key={group.kind} className="space-y-2"><h3 className="font-semibold">{group.title}</h3>
        {!group.rows.length && <p className="text-sm text-slate-500">Keine öffentlichen Boards eingerichtet.</p>}
        {group.rows.map(resource => { const setting=settings.find(value=>value.kind===group.kind && (group.kind==="inventory"?value.inventoryBoardId===resource.id:value.boardId===resource.id));return <form key={resource.id} action={saveEmailConfirmationAction.bind(null,group.kind,resource.id)} className="flex flex-wrap items-center justify-between gap-3 rounded border p-3">
          <label className="flex items-center gap-2 text-sm"><input name="enabled" type="checkbox" defaultChecked={setting?.enabled ?? false} />{resource.name}</label><SubmitButton className="btn-secondary btn-sm">Speichern</SubmitButton>
        </form>;})}
      </div>)}
    </section>
    <section className="card space-y-3 p-5"><h2 className="text-lg font-semibold">Versandwarteschlange</h2><p className="text-sm">{counts.map(value=>`${({pending:"Ausstehend",sending:"In Bearbeitung",sent:"Gesendet",failed:"Fehlgeschlagen"})[value.state]}: ${value.count}`).join(" · ") || "Keine Nachrichten vorhanden."}</p>
      <form action={retryFailedEmailsAction}><SubmitButton className="btn-secondary">Fehlgeschlagene Nachrichten erneut versuchen</SubmitButton></form>
    </section>
  </div>;
}
