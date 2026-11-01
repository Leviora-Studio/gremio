// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
"use client";
import { useEffect, useRef } from "react";

/** Settings forms retain their current values after an action or validation error. */
export function useRetainedForm() {
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = ref.current;
    if (!form) return;
    const retain = (event: Event) => event.preventDefault();
    // React can reset forms during commit while synthetic event dispatch is
    // disabled. A JSX onReset handler alone does not cover that native reset.
    form.addEventListener("reset", retain);
    return () => form.removeEventListener("reset", retain);
  }, []);
  return ref;
}
