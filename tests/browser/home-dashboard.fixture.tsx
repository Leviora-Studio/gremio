// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import React from "react";
import { createRoot } from "react-dom/client";
import { HomeDashboard } from "../../components/HomeDashboard";
import { normalizeHomePref } from "../../lib/home-dashboard";

const section = (title: string) => <div><h2>{title}</h2><p>Testinhalt</p></div>;

Object.assign(window, { savedHomePrefs: [] });
createRoot(document.getElementById("root")!).render(
  <HomeDashboard
    home={normalizeHomePref(undefined)}
    tasks={section("Meine Aufgaben")}
    boards={section("Deine Boards")}
    protocols={section("Protokollbereiche")}
    finances={section("Finanzübersichten")}
    inventories={section("Deine Inventare")}
  />,
);
