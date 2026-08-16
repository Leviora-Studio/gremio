// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import forge from "node-forge";
import { decryptSecret, encryptSecret } from "@/lib/crypto";

export class CertError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CertError";
  }
}

export type CertInfo = {
  subjectCN: string | null;
  issuerCN: string | null;
  notBefore: Date;
  notAfter: Date;
};

function cn(
  attrs: forge.pki.CertificateField[] | undefined,
): string | null {
  const f = attrs?.find((a) => a.shortName === "CN" || a.name === "commonName");
  return typeof f?.value === "string" ? f.value : null;
}

/** Leaf-/Unterzeichner-Zertifikat: bevorzugt Nicht-CA, sonst das erste. */
function pickLeaf(certs: forge.pki.Certificate[]): forge.pki.Certificate {
  const leaf = certs.find((c) => {
    const bc = c.getExtension("basicConstraints") as
      | { cA?: boolean }
      | undefined;
    return !bc || bc.cA !== true;
  });
  return leaf ?? certs[0];
}

/**
 * Öffnet eine .p12 mit der Passphrase und liest Inhaber/Gültigkeit des
 * Signatur-Zertifikats. Wirft CertError bei falscher Passphrase, fehlendem
 * (kompatiblem) Schlüssel oder fehlendem Zertifikat — zur Validierung beim
 * Hochladen.
 */
export function inspectP12(p12Der: Buffer, passphrase: string): CertInfo {
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(
      forge.util.createBuffer(p12Der.toString("binary")),
    );
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
  } catch {
    throw new CertError(
      "Zertifikat oder Passwort ungültig — die Datei ließ sich nicht öffnen.",
    );
  }

  // @signpdf benötigt einen pkcs8ShroudedKeyBag (OpenSSL-Standard für .p12).
  const keyBags = p12.getBags({
    bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
  });
  const hasKey =
    (keyBags[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []).length > 0;
  if (!hasKey) {
    throw new CertError(
      "Die .p12 enthält keinen kompatiblen privaten Schlüssel (pkcs8ShroudedKeyBag erwartet).",
    );
  }

  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });
  const certs = (certBags[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  if (!certs.length) throw new CertError("Die .p12 enthält kein Zertifikat.");

  const signer = pickLeaf(certs);
  return {
    subjectCN: cn(signer.subject.attributes),
    issuerCN: cn(signer.issuer.attributes),
    notBefore: signer.validity.notBefore,
    notAfter: signer.validity.notAfter,
  };
}

/** Für die verschlüsselte Speicherung: .p12-Bytes (base64) + Passphrase. */
export function encryptCert(
  p12Der: Buffer,
  passphrase: string,
): { p12Enc: string; passEnc: string } {
  return {
    p12Enc: encryptSecret(p12Der.toString("base64")),
    passEnc: encryptSecret(passphrase),
  };
}

/** Entschlüsselt das gespeicherte Zertifikat eines Nutzers (null = keins). */
export function decryptUserCert(u: {
  certP12Enc: string | null;
  certPassEnc: string | null;
}): { p12: Buffer; passphrase: string } | null {
  if (!u.certP12Enc || !u.certPassEnc) return null;
  return {
    p12: Buffer.from(decryptSecret(u.certP12Enc), "base64"),
    passphrase: decryptSecret(u.certPassEnc),
  };
}
