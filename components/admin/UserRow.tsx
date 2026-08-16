// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

"use client";

import { Avatar } from "@/components/Avatar";
import { ConfirmButton } from "@/components/ConfirmButton";
import { setRoleAction } from "@/app/admin/users/actions";

type Role = "admin" | "template_manager" | "user";

type UserLite = {
  id: number;
  username: string;
  name: string | null;
  email: string | null;
  role: Role;
  isActive: boolean;
  avatarPath: string | null;
};

const ROLE_LABEL: Record<Role, string> = {
  admin: "Admin",
  template_manager: "Template-Verwalter",
  user: "Nutzer",
};

const ROLE_MESSAGE: Record<Role, string> = {
  admin:
    "Der Nutzer erhält volle Admin-Rechte (alle Boards, Gruppen, Templates, Standorte und Nutzerrollen).",
  template_manager:
    "Der Nutzer darf zusätzlich Board- und Finanz-Templates verwalten (sonst wie ein normaler Nutzer).",
  user: "Der Nutzer wird ein normaler Benutzer ohne Sonderrechte.",
};

/**
 * Tipp-Schutzwort je Rollenwechsel:
 * → Admin: ADMIN · → Template-Verwalter (befördern): TEMPLATE ·
 * Admin entziehen bzw. Template-Verwalter entziehen: ENTZIEHEN.
 */
function requiredWord(current: Role, target: Role): string {
  if (target === "admin") return "ADMIN";
  if (current === "admin") return "ENTZIEHEN"; // Admin-Rechte werden entzogen
  if (target === "template_manager") return "TEMPLATE"; // Nutzer → Template-Verwalter
  return "ENTZIEHEN"; // Template-Verwalter → Nutzer
}

export function UserRow({
  user,
  meId,
  adminCount,
}: {
  user: UserLite;
  meId: number;
  adminCount: number;
}) {
  const isSelf = user.id === meId;
  const isProtectedAdmin = user.role === "admin" && adminCount <= 1;
  const name = user.name ?? user.username;

  const targets = (["admin", "template_manager", "user"] as const).filter(
    (r) => r !== user.role,
  );

  return (
    <div className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Avatar
            username={name}
            src={user.avatarPath ? `/api/avatar/${user.id}` : null}
            size={36}
          />
          <div>
            <span className="font-medium">{name}</span>
            <span className="ml-2 text-xs text-slate-400">{user.username}</span>
            <span className="ml-2 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
              {ROLE_LABEL[user.role]}
            </span>
            {!user.isActive && (
              <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                inaktiv
              </span>
            )}
            {isSelf && <span className="ml-2 text-xs text-slate-400">(du)</span>}
            {user.email && (
              <div className="text-xs text-slate-400">{user.email}</div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {targets.map((r) => {
            // Admin-Rechte abgeben (admin → andere Rolle) nur, wenn erlaubt.
            if (user.role === "admin" && (isSelf || isProtectedAdmin)) return null;
            const word = requiredWord(user.role, r);
            return (
              <ConfirmButton
                key={r}
                action={setRoleAction.bind(null, user.id, r)}
                className="btn-secondary px-3 py-1.5"
                label={`Zu ${ROLE_LABEL[r]}`}
                title={`„${name}" zu ${ROLE_LABEL[r]} machen`}
                message={ROLE_MESSAGE[r]}
                confirmLabel={`Zu ${ROLE_LABEL[r]} machen`}
                confirmClassName={word === "ENTZIEHEN" ? "btn-danger" : "btn-primary"}
                requireTyped={word}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
