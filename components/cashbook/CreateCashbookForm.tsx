// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createCashbookAction, type CashbookActionState } from "@/app/intern/kassenbuch/actions";
export function CreateCashbookForm() { const [state, action, pending] = useActionState(createCashbookAction, {} as CashbookActionState); const router = useRouter(); useEffect(() => { if (state.id)
    router.push(`/intern/kassenbuch/${state.id}/einstellungen`); }, [state.id, router]); return <form noValidate action={action} className="card space-y-3 p-5"><h2 className="font-semibold">Kassenbuch anlegen</h2><label className="block text-sm">Name<input className="input mt-1" name="name" required maxLength={120}/></label><button disabled={pending} className="btn-primary">Kassenbuch erstellen</button>{state.error && <p role="alert" className="text-red-700">{state.error}</p>}</form>; }
