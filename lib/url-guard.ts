// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Erik Engler

/**
 * SSRF-Schutz: erlaubt nur http(s) auf öffentlich erreichbare Hosts.
 * Blockt Loopback, private/Link-Local/CGNAT-Bereiche (inkl. Cloud-Metadata
 * 169.254.169.254), einlabelige Hostnamen (Docker-Service-Namen) sowie
 * IPv4-mapped IPv6 (z. B. ::ffff:127.0.0.1) und nicht-globale IPv6.
 *
 * `isPublicHost` prüft Hostnamen UND aufgelöste IPs und wird daher auch im
 * verbindungszeitlichen DNS-Lookup des Nextcloud-Clients wiederverwendet
 * (dort wird die IP zusätzlich gepinnt → echter Anti-Rebinding-Schutz).
 */

/** IPv4-mapped IPv6 → eingebettete IPv4 (sonst null). Node liefert die Hex-Form. */
function mappedIpv4(host: string): string | null {
  // ::ffff:127.0.0.1 (gepunktet)
  let m = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i);
  if (m) return m[1];
  // ::ffff:7f00:1 (zwei 16-bit-Hex-Gruppen) bzw. ::a.b.c.d → hier ::ffff:hi:lo
  m = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m) {
    const hi = parseInt(m[1], 16);
    const lo = parseInt(m[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return null;
}

function isPublicIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return true; // kein IPv4-Literal → hier nicht entscheidbar
  const a = Number(m[1]);
  const b = Number(m[2]);
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  if (a === 0 || a === 127) return false; // this-network / loopback
  if (a === 10) return false; // privat
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT 100.64/10
  if (a === 172 && b >= 16 && b <= 31) return false; // privat
  if (a === 192 && b === 168) return false; // privat
  if (a === 169 && b === 254) return false; // link-local / Metadata
  if (a >= 224) return false; // multicast / reserviert / broadcast
  return true;
}

/** true = öffentlicher Host/IP; false = intern/privat/reserviert/einlabelig. */
export function isPublicHost(rawHost: string): boolean {
  // URL.hostname liefert IPv6 in Klammern ("[::1]") — entfernen.
  const host = rawHost.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return false;

  if (host === "localhost" || host.endsWith(".localhost")) return false;

  const isIpv6 = host.includes(":");

  if (isIpv6) {
    // IPv4-mapped IPv6 auf die eingebettete IPv4 zurückführen und prüfen.
    const mapped = mappedIpv4(host);
    if (mapped) return isPublicIpv4(mapped);
    if (host === "::1" || host === "::") return false; // loopback / unspezifiziert
    if (host.startsWith("fe80")) return false; // link-local
    if (host.startsWith("fc") || host.startsWith("fd")) return false; // ULA
    // Konservativ: nur global-unicast IPv6 (2000::/3) zulassen — alles andere
    // (NAT64 64:ff9b::, reservierte Bereiche …) blocken.
    if (!host.startsWith("2") && !host.startsWith("3")) return false;
    return true;
  }

  // Einlabelige Hostnamen (Docker-Service-Namen „db", „sso", „app") blocken.
  if (!host.includes(".")) return false;

  return isPublicIpv4(host);
}

/** Validiert eine komplette URL (Schema + Host). Kein DNS-Lookup. */
export function isSafeExternalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return isPublicHost(u.hostname);
}
