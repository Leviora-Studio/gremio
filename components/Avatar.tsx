// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Erik Engler

import { clsx } from "clsx";

function initials(username: string): string {
  const parts = username
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return username.slice(0, 2).toUpperCase();
}

// Deterministische Farbe aus dem Benutzernamen.
function colorFor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 55% 45%)`;
}

export function Avatar({
  username,
  src,
  size = 32,
  className,
}: {
  username: string;
  src?: string | null;
  size?: number;
  className?: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={username}
        width={size}
        height={size}
        className={clsx("rounded-full object-cover", className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={clsx(
        "inline-flex select-none items-center justify-center rounded-full font-semibold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: colorFor(username),
        fontSize: size * 0.4,
      }}
      title={username}
    >
      {initials(username)}
    </span>
  );
}
