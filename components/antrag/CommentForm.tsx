// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

"use client";

import { useActionState, useEffect, useRef } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { addCommentAction, type State } from "@/app/intern/card/[id]/actions";

export function CommentForm({ cardId }: { cardId: number }) {
  const [state, action] = useActionState(
    addCommentAction.bind(null, cardId),
    {} as State,
  );
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success) ref.current?.reset();
  }, [state.success]);

  return (
    <form ref={ref} action={action} className="space-y-2">
      <textarea
        name="body"
        rows={3}
        className="input"
        placeholder="Kommentar schreiben …"
      />
      <div className="flex items-center gap-3">
        <SubmitButton className="btn-primary">Kommentieren</SubmitButton>
        {state.error && (
          <span className="text-sm text-red-600">{state.error}</span>
        )}
      </div>
    </form>
  );
}
