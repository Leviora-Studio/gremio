# SPDX-License-Identifier: AGPL-3.0-only
# Copyright (C) 2026 Leviora Studio
"""Offline validation of SYNTHETIC test certificates; never a production trust policy."""
import json
import sys
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

results = []
with open(sys.argv[1], "rb") as stream:
    signatures = PdfFileReader(stream).embedded_signatures
    assert len(signatures) == int(sys.argv[2])
    assert len({sig.field_name for sig in signatures}) == len(signatures)
    for signature in signatures:
        context = ValidationContext(trust_roots=[signature.signer_cert], allow_fetching=False)
        status = validate_pdf_signature(signature, signer_validation_context=context)
        assert status.intact and status.valid and status.docmdp_ok, status.summary()
        assert status.coverage.name in ("ENTIRE_FILE", "ENTIRE_REVISION"), status.summary()
        results.append({"intact": status.intact, "valid": status.valid, "docmdp_ok": status.docmdp_ok})
print(json.dumps(results))
