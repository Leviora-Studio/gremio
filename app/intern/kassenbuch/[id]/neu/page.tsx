// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import { requireUser } from "@/lib/auth";
import { requireCashbook } from "@/lib/cashbook/access";
import { cashbookCandidates } from "@/lib/cashbook/projection";
import { buildCardNumber } from "@/lib/numbering";
import { todayInBerlin } from "@/lib/dates";
import { CashbookDraftProvider } from "@/components/cashbook/DraftContext";
import { PaymentEditor } from "@/components/cashbook/PaymentEditor";
export default async function NewBooking({ params }: {
    params: Promise<{
        id: string;
    }>;
}) { const user = await requireUser(), { book } = await requireCashbook(user, Number((await params).id), "write"); return <div className="mx-auto max-w-6xl space-y-5"><h1 className="text-2xl font-bold">Buchung anlegen</h1><CashbookDraftProvider><PaymentEditor bookId={book.id} entryId={null} revision={0} role={book.config.speakerId === user.id ? "speaker" : book.config.financeId === user.id ? "finance" : null} candidates={await cashbookCandidates(user, book)} previewNumber={buildCardNumber(book.config.numbering, book.nextNumber)} initial={{ cardId: null, business: false, number: "", receiptIds: [], amount: 0, budgetTitle: "", holder: "", iban: "", bank: "", purpose: "", place: "", date: todayInBerlin() }}/></CashbookDraftProvider></div>; }
