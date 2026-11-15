// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/** Optional independent parser, trust-chain and revision validation for synthetic PDFs. */
export function validatePdfInteroperability(path: string, expectedSignatures: number): void {
    const python = process.env.GREMIO_SIGNATURE_VALIDATOR_PYTHON;
    if (!python) return;
    const checked = spawnSync(python,[resolve("tests/helpers/pdf-signature-validation.py"),path,String(expectedSignatures)],{encoding:"utf8",timeout:30000});
    assert.equal(checked.status,0,checked.stderr || checked.stdout);
    const signatures = JSON.parse(checked.stdout) as {intact:boolean;valid:boolean;docmdp_ok:boolean}[];
    assert.equal(signatures.length,expectedSignatures);
    assert.ok(signatures.every(signature=>signature.intact && signature.valid && signature.docmdp_ok));
}
