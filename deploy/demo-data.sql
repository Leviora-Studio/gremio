-- SPDX-License-Identifier: AGPL-3.0-only
-- Copyright (C) 2026 Leviora Studio
--
-- Beispieldaten für Staging/Demo-Instanzen. NICHT auf Produktion ausführen.
--
-- Voraussetzungen:
--   * Migrationen gelaufen (App einmal gestartet)
--   * Der ADMIN_USER hat sich mindestens einmal per SSO angemeldet
--     (Eigentümer aller Demo-Boards ist der älteste Admin)
--
-- Ausführen (auf dem Server, im Compose-Ordner):
--   docker compose exec -T db psql -U gremio -d gremio -v ON_ERROR_STOP=1 < demo-data.sql
--
-- Läuft in EINER Transaktion und bricht ab, wenn die Demo-Daten schon existieren.
-- Alles Angelegte ist mit „Demo" bzw. dem Benutzerpräfix „demo." erkennbar.
-- Demo-Nutzer haben kein SSO-Subject und können sich nicht anmelden; sie dienen
-- nur als Zuweisungen, Gruppenmitglieder und Freigabeempfänger.
-- Dateianhänge werden bewusst NICHT erzeugt (sie bräuchten Dateien im Upload-Volume).

BEGIN;

-- Status-Token im App-Format (lib/constants.ts: TOKEN_ALPHABET, TOKEN_LENGTH = 30).
CREATE FUNCTION pg_temp.demo_token() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT string_agg(
    substr('0123456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ',
           1 + floor(random() * 58)::int, 1), '')
  FROM generate_series(1, 30)
$$;

-- Status-ID eines Boards per Spaltenname.
CREATE FUNCTION pg_temp.st(b int, n text) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT id FROM board_statuses WHERE board_id = b AND name = n
$$;

-- Nutzer-ID per Benutzername.
CREATE FUNCTION pg_temp.uid(n text) RETURNS int LANGUAGE sql STABLE AS $$
  SELECT id FROM users WHERE username = n
$$;

DO $demo$
DECLARE
  v_admin int;
  v_anna int; v_ben int; v_clara int; v_david int;
  g_fin int; g_vorstand int;
  acc_allg int; acc_kultur int; acc_sport int;
  p_low int; p_mid int; p_high int;
  b_antrag int; b_feedback int; b_projekte int; b_loan int;
  c int;
  fb int;
  ft int; fp int;
  inv int;
  o_technik int; o_audio int; o_moebel int; o_buero int; o_lager int;
  i_beamer int; i_mic1 int; i_mic2 int; i_mic3 int; i_becher int; i_box int; i_tisch int; i_laptop int;
  l int;
  k text;
  i int;
  area_mensa int; area_lehre int;
  today date := current_date;
BEGIN
  -- ---------------------------------------------------------------- Guards
  SELECT id INTO v_admin FROM users WHERE role = 'admin' ORDER BY id LIMIT 1;
  IF v_admin IS NULL THEN
    RAISE EXCEPTION 'Kein Admin vorhanden — bitte zuerst mit ADMIN_USER per SSO anmelden.';
  END IF;
  IF EXISTS (SELECT 1 FROM boards WHERE name = 'Demo: Finanzanträge') THEN
    RAISE EXCEPTION 'Demo-Daten existieren bereits (Board „Demo: Finanzanträge").';
  END IF;

  -- ---------------------------------------------------------------- Nutzer & Gruppen
  INSERT INTO users (username, name, email, role) VALUES
    ('demo.anna',  'Anna Becker',   'anna.becker@example.org',  'user'),
    ('demo.ben',   'Ben Schulz',    'ben.schulz@example.org',   'user'),
    ('demo.clara', 'Clara Neumann', 'clara.neumann@example.org','template_manager'),
    ('demo.david', 'David Wolf',    'david.wolf@example.org',   'user')
  ON CONFLICT (username) DO NOTHING;
  v_anna := pg_temp.uid('demo.anna');
  v_ben := pg_temp.uid('demo.ben');
  v_clara := pg_temp.uid('demo.clara');
  v_david := pg_temp.uid('demo.david');

  INSERT INTO groups (name, description) VALUES
    ('Demo Finanzreferat', 'Beispielgruppe: bearbeitet Finanzanträge')
    ON CONFLICT (name) DO NOTHING;
  INSERT INTO groups (name, description) VALUES
    ('Demo Vorstand', 'Beispielgruppe: Leitung')
    ON CONFLICT (name) DO NOTHING;
  SELECT id INTO g_fin FROM groups WHERE name = 'Demo Finanzreferat';
  SELECT id INTO g_vorstand FROM groups WHERE name = 'Demo Vorstand';
  INSERT INTO user_groups (user_id, group_id) VALUES
    (v_anna, g_fin), (v_ben, g_fin), (v_admin, g_vorstand), (v_clara, g_vorstand)
  ON CONFLICT DO NOTHING;

  -- ---------------------------------------------------------------- Kataloge
  INSERT INTO accounts (name, position) VALUES
    ('Demo Haushalt Allgemein', 100), ('Demo Kulturkonto', 101), ('Demo Sportkonto', 102)
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO acc_allg FROM accounts WHERE name = 'Demo Haushalt Allgemein';
  SELECT id INTO acc_kultur FROM accounts WHERE name = 'Demo Kulturkonto';
  SELECT id INTO acc_sport FROM accounts WHERE name = 'Demo Sportkonto';

  IF NOT EXISTS (SELECT 1 FROM priorities) THEN
    INSERT INTO priorities (label, color, position) VALUES
      ('Niedrig', 'slate', 0), ('Mittel', 'amber', 1), ('Hoch', 'red', 2);
  END IF;
  SELECT id INTO p_low  FROM priorities ORDER BY position, id LIMIT 1;
  SELECT id INTO p_mid  FROM priorities ORDER BY position, id LIMIT 1 OFFSET 1;
  SELECT id INTO p_high FROM priorities ORDER BY position, id LIMIT 1 OFFSET 2;

  -- ================================================================ Board 1: Finanzanträge
  INSERT INTO boards (name, description, owner_id, default_account_id)
    VALUES ('Demo: Finanzanträge', 'Beispiel-Antragsboard mit allen Feldern', v_admin, acc_allg)
    RETURNING id INTO b_antrag;
  INSERT INTO board_statuses (board_id, name, position, is_archive_trigger, is_receipt_trigger, is_instruction_trigger, is_transfer_trigger) VALUES
    (b_antrag, 'Eingegangen',             0, false, false, false, false),
    (b_antrag, 'Geplant für Sitzung',     1, false, false, false, false),
    (b_antrag, 'Abgelehnt',               2, false, false, false, false),
    (b_antrag, 'Warten auf Nachreichung', 3, false, false, false, false),
    (b_antrag, 'Angenommen',              4, false, true,  false, false),
    (b_antrag, 'Quittungen erhalten',     5, false, false, false, false),
    (b_antrag, 'Anweisung erfolgt',       6, true,  false, true,  false),
    (b_antrag, 'Überwiesen',              7, false, false, false, true);
  UPDATE boards SET
    resubmit_status_id = pg_temp.st(b_antrag, 'Warten auf Nachreichung'),
    receipt_to_status_id = pg_temp.st(b_antrag, 'Quittungen erhalten')
  WHERE id = b_antrag;
  INSERT INTO board_card_fields (board_id, field_key, visible, position)
    SELECT b_antrag, f.key, true, f.ord - 1
    FROM unnest(ARRAY['number','applicant','budget_title','requested_amount','approved_amount',
      'actual_amount','creator','assignee','deadline','meeting','decision_ref','instruction_date',
      'transfer_date','priority','account','finance_request','annex_a','annex_b','student_card',
      'other_pdfs','notes','applicant_note']) WITH ORDINALITY AS f(key, ord);
  INSERT INTO board_archive (board_id, enabled) VALUES (b_antrag, false);
  INSERT INTO board_numbering (board_id, enabled, prefix, year, code, separator, padding, next)
    VALUES (b_antrag, true, 'A', to_char(today, 'YYYY'), 'DEMO', '_', 3, 1);
  INSERT INTO board_access (board_id, group_id, access_level) VALUES (b_antrag, g_fin, 'write');
  INSERT INTO board_access (board_id, user_id, access_level) VALUES (b_antrag, v_david, 'read');
  -- Bürokraft: David darf (nur) Eingegangen → Geplant für Sitzung verschieben.
  INSERT INTO board_office_roles (board_id, enabled, user_id) VALUES (b_antrag, true, v_david);
  INSERT INTO board_office_statuses (board_id, status_id, direction) VALUES
    (b_antrag, pg_temp.st(b_antrag, 'Eingegangen'), 'source'),
    (b_antrag, pg_temp.st(b_antrag, 'Geplant für Sitzung'), 'target');
  -- Trigger-Zuweisung: Anweisungsdatum → Zuweisungen leeren, Anna zuweisen.
  INSERT INTO board_trigger_assignments (board_id, trigger, clear_assignees) VALUES (b_antrag, 'instruction', true);
  INSERT INTO board_trigger_assignees (board_id, trigger, user_id) VALUES (b_antrag, 'instruction', v_anna);

  -- Karten (Antragsnummer = A{nnn}_{Jahr}_DEMO)
  CREATE TEMP TABLE demo_cards (
    n int, col text, title text, applicant text, email text, budget text, acc int,
    req int, appr int, act int, prio int, deadline_off int, meeting_off int,
    decision text, assignee int, notes text, applicant_note text, from_form boolean
  ) ON COMMIT DROP;
  INSERT INTO demo_cards VALUES
    (1,  'Eingegangen',             'Grillabend am FB5',                'Max Mustermann',   'max@example.org',   '1.1 Kultur', acc_kultur, 45000, NULL, NULL, p_mid,  14,  10, NULL, v_anna, 'Bitte Kostenvoranschlag nachfordern.', NULL, true),
    (2,  'Eingegangen',             'Erstsemester-Rallye',              'Lena Krüger',      'lena@example.org',  '1.3 Erstsemester', acc_allg, 120000, NULL, NULL, p_high, 5, 10, NULL, NULL, NULL, NULL, true),
    (3,  'Eingegangen',             'Neue Tischtennisplatte',           'Sportgruppe Nord', 'sport@example.org', '1.2 Sport', acc_sport, 89900, NULL, NULL, p_low, -3, NULL, NULL, v_ben, 'Deadline überschritten — Rückfrage offen.', NULL, true),
    (4,  'Geplant für Sitzung',     'Filmabend „Kino unterm Dach"',     'Filmgruppe',       NULL,                '1.1 Kultur', acc_kultur, 30000, NULL, NULL, p_mid, 20, 10, NULL, v_anna, NULL, NULL, false),
    (5,  'Geplant für Sitzung',     'Exkursion Landtag',                'FS Politik',       'politik@example.org','1.4 Exkursionen', acc_allg, 250000, NULL, NULL, p_high, 25, 10, NULL, v_ben, NULL, NULL, true),
    (6,  'Abgelehnt',               'Firmenfeier Sponsor XY',           'Unbekannt',        NULL,                NULL, NULL, 500000, 0, NULL, p_low, NULL, -18, 'Beschluss 07/2026', NULL, 'Nicht förderfähig.', 'Leider nicht förderfähig nach Finanzordnung §4.', false),
    (7,  'Warten auf Nachreichung', 'Workshop Siebdruck',               'Kunstkollektiv',   'kunst@example.org', '1.1 Kultur', acc_kultur, 60000, NULL, NULL, p_mid, 7, -4, 'Beschluss 11/2026', v_anna, NULL, 'Bitte unterschriebenen Antrag nachreichen.', true),
    (8,  'Angenommen',              'Hochschulsport-Turnier',           'Sportgruppe Süd',  'sued@example.org',  '1.2 Sport', acc_sport, 150000, 140000, NULL, p_mid, NULL, -11, 'Beschluss 09/2026', v_ben, NULL, 'Bitte Quittungen über den Status-Link hochladen.', true),
    (9,  'Quittungen erhalten',     'Sommerfest 2026',                  'Festkomitee',      'fest@example.org',  '1.1 Kultur', acc_kultur, 400000, 380000, 371250, p_high, NULL, -32, 'Beschluss 05/2026', v_anna, 'Quittungen vollständig.', NULL, true),
    (10, 'Anweisung erfolgt',       'Druckkosten Erstsemesterheft',     'Redaktion',        NULL,                '2.1 Verwaltung', acc_allg, 80000, 80000, 78340, p_low, NULL, -46, 'Beschluss 03/2026', v_anna, NULL, NULL, false),
    (11, 'Überwiesen',              'Bandauftritt Campusfest',          'Musikgruppe',      'band@example.org',  '1.1 Kultur', acc_kultur, 50000, 50000, 50000, p_low, NULL, -60, 'Beschluss 02/2026', NULL, NULL, NULL, true);

  FOR c IN SELECT n FROM demo_cards ORDER BY n LOOP
    INSERT INTO cards (board_id, status_id, location_id, title, applicant, submitter_email, budget_title,
      requested_amount, approved_amount, actual_amount, number, token, creator_user_id, deadline, meeting,
      decision_ref, instruction_date, transfer_date, priority_id, account_id, notes, applicant_note, position,
      created_at, updated_at)
    SELECT b_antrag, pg_temp.st(b_antrag, d.col),
      CASE WHEN d.from_form THEN (SELECT id FROM locations ORDER BY position, id LIMIT 1) END,
      d.title, d.applicant, d.email, d.budget, d.req, d.appr, d.act,
      'A' || lpad(d.n::text, 3, '0') || '_' || to_char(today, 'YYYY') || '_DEMO',
      pg_temp.demo_token(),
      CASE WHEN d.from_form THEN NULL ELSE v_admin END,
      CASE WHEN d.deadline_off IS NOT NULL THEN to_char(today + d.deadline_off, 'YYYY-MM-DD') END,
      CASE WHEN d.meeting_off IS NOT NULL THEN to_char(today + d.meeting_off, 'YYYY-MM-DD') END,
      d.decision,
      CASE WHEN d.col IN ('Anweisung erfolgt', 'Überwiesen') THEN to_char(today - 10, 'YYYY-MM-DD') END,
      CASE WHEN d.col = 'Überwiesen' THEN to_char(today - 5, 'YYYY-MM-DD') END,
      d.prio, d.acc, d.notes, d.applicant_note,
      (SELECT count(*) FROM cards x WHERE x.board_id = b_antrag AND x.status_id = pg_temp.st(b_antrag, d.col)),
      now() - ((60 - d.n * 5) || ' days')::interval, now() - ((12 - d.n) || ' hours')::interval
    FROM demo_cards d WHERE d.n = c;
  END LOOP;
  UPDATE board_numbering SET next = 13 WHERE board_id = b_antrag;

  -- Eine Karte im Modus „Haushaltspositionen" (Summen = Positionen).
  INSERT INTO cards (board_id, status_id, title, applicant, budget_mode, requested_amount, approved_amount,
      number, token, creator_user_id, meeting, priority_id, notes, position)
    VALUES (b_antrag, pg_temp.st(b_antrag, 'Angenommen'), 'Campus-Festival (mehrere Posten)', 'AStA Kultur',
      'positions', 330000, 300000, 'A012_' || to_char(today, 'YYYY') || '_DEMO', pg_temp.demo_token(), v_admin,
      to_char(today - 11, 'YYYY-MM-DD'), p_high, 'Beispiel für eine Karte mit mehreren Haushaltspositionen.', 1)
    RETURNING id INTO c;
  INSERT INTO card_budget_positions (id, card_id, position, budget_title, description, account_id, requested_amount, approved_amount, actual_amount) VALUES
    (gen_random_uuid()::text, c, 0, '1.1 Kultur', 'Bühnentechnik', acc_kultur, 180000, 160000, NULL),
    (gen_random_uuid()::text, c, 1, '1.1 Kultur', 'Gagen',         acc_kultur, 100000, 100000, NULL),
    (gen_random_uuid()::text, c, 2, '2.1 Verwaltung', 'Security',  acc_allg,    50000,  40000, NULL);

  -- Zuweisungen, Aktivität, Kommentare
  INSERT INTO card_assignees (card_id, user_id)
    SELECT cd.id, d.assignee FROM cards cd JOIN demo_cards d ON cd.title = d.title
    WHERE cd.board_id = b_antrag AND d.assignee IS NOT NULL;
  INSERT INTO card_assignees (card_id, user_id) VALUES (c, v_admin), (c, v_ben);

  INSERT INTO card_activity (card_id, user_id, type, detail, created_at)
    SELECT id, creator_user_id, 'created',
      CASE WHEN location_id IS NOT NULL THEN 'Über das öffentliche Formular eingereicht' ELSE 'Karte erstellt' END,
      created_at
    FROM cards WHERE board_id = b_antrag;
  INSERT INTO card_activity (card_id, user_id, type, detail, created_at)
    SELECT cd.id, v_anna, 'status', 'Status: Eingegangen → ' || bs.name, cd.updated_at
    FROM cards cd JOIN board_statuses bs ON bs.id = cd.status_id
    WHERE cd.board_id = b_antrag AND bs.name <> 'Eingegangen';

  INSERT INTO card_comments (card_id, user_id, body, created_at)
    SELECT cd.id, v, body, now() - ago::interval
    FROM cards cd
    JOIN (VALUES
      ('Grillabend am FB5',       v_anna,  'Habe beim Antragsteller ein zweites Angebot angefragt.', '2 days'),
      ('Grillabend am FB5',       v_admin, 'Danke! Bitte bis zur nächsten Sitzung klären.',          '1 day'),
      ('Exkursion Landtag',       v_ben,   'Busunternehmen bestätigt, Preis gilt bis Monatsende.',   '3 days'),
      ('Sommerfest 2026',         v_anna,  'Alle Quittungen geprüft, Differenz 8,75 € zurück.',      '6 hours'),
      ('Workshop Siebdruck',      v_admin, 'Antrag ohne Unterschrift eingegangen.',                  '5 days')
    ) AS x(title, v, body, ago) ON x.title = cd.title
    WHERE cd.board_id = b_antrag;

  -- ================================================================ Board 2: Feedback
  INSERT INTO boards (name, description, owner_id)
    VALUES ('Demo: Feedback', 'Eingänge aus dem öffentlichen Feedback-Formular', v_admin)
    RETURNING id INTO b_feedback;
  INSERT INTO board_statuses (board_id, name, position) VALUES
    (b_feedback, 'Neu', 0), (b_feedback, 'In Bearbeitung', 1), (b_feedback, 'Beantwortet', 2);
  INSERT INTO board_card_fields (board_id, field_key, visible, position)
    SELECT b_feedback, f.key, f.key IN ('applicant','assignee','priority','notes','applicant_note'), f.ord - 1
    FROM unnest(ARRAY['number','applicant','budget_title','requested_amount','approved_amount',
      'actual_amount','creator','assignee','deadline','meeting','decision_ref','instruction_date',
      'transfer_date','priority','account','finance_request','annex_a','annex_b','student_card',
      'other_pdfs','notes','applicant_note']) WITH ORDINALITY AS f(key, ord);
  INSERT INTO board_archive (board_id, enabled) VALUES (b_feedback, false);
  INSERT INTO board_numbering (board_id) VALUES (b_feedback);
  INSERT INTO board_access (board_id, group_id, access_level) VALUES (b_feedback, g_vorstand, 'write');

  INSERT INTO feedback_areas (name, enabled, position, target_board_id, target_status_id) VALUES
    ('Demo Mensa', true, 100, b_feedback, pg_temp.st(b_feedback, 'Neu')),
    ('Demo Lehre', true, 101, b_feedback, pg_temp.st(b_feedback, 'Neu'))
  ON CONFLICT (name) DO NOTHING;
  SELECT id INTO area_mensa FROM feedback_areas WHERE name = 'Demo Mensa';
  SELECT id INTO area_lehre FROM feedback_areas WHERE name = 'Demo Lehre';

  FOR i IN 1..4 LOOP
    INSERT INTO cards (board_id, status_id, title, applicant, notes, token, position, priority_id, created_at)
    SELECT b_feedback, pg_temp.st(b_feedback, col), left(txt, 120), who, txt, pg_temp.demo_token(), 0, prio,
      now() - (i || ' days')::interval
    FROM (VALUES
      (1, 'Neu',            'Anonym',      'Die vegetarische Auswahl in der Mensa ist zu klein, gerade freitags gibt es oft nur eine Option.', p_mid),
      (2, 'Neu',            'Jonas',       'Bitte längere Öffnungszeiten der Bibliothek in der Prüfungsphase!', p_low),
      (3, 'In Bearbeitung', 'Anonym',      'Im Hörsaal 3 funktioniert das Mikrofon seit Wochen nicht.', p_high),
      (4, 'Beantwortet',    'Mia Hoffmann','Danke für die schnelle Reaktion beim Thema Lernräume.', NULL)
    ) AS v(n, col, who, txt, prio) WHERE v.n = i
    RETURNING id INTO c;
    INSERT INTO feedback_submissions (card_id, area_id, area_name, submitter_name, feedback_text)
      SELECT cd.id, CASE WHEN i IN (1) THEN area_mensa ELSE area_lehre END,
        CASE WHEN i IN (1) THEN 'Demo Mensa' ELSE 'Demo Lehre' END, cd.applicant, cd.notes
      FROM cards cd WHERE cd.id = c;
    INSERT INTO card_activity (card_id, type, detail) VALUES (c, 'created', 'Über das öffentliche Feedback-Formular eingereicht');
  END LOOP;
  UPDATE cards SET applicant_note = 'Wir haben das an die Haustechnik weitergegeben.'
    WHERE board_id = b_feedback AND title LIKE 'Im Hörsaal 3%';

  -- ================================================================ Board 3: Projekte (Anna)
  INSERT INTO boards (name, description, owner_id)
    VALUES ('Demo: Projekte', 'Allgemeines Kanban ohne Formular', v_anna)
    RETURNING id INTO b_projekte;
  INSERT INTO board_statuses (board_id, name, position) VALUES
    (b_projekte, 'Ideen', 0), (b_projekte, 'In Arbeit', 1), (b_projekte, 'Review', 2), (b_projekte, 'Fertig', 3);
  INSERT INTO board_card_fields (board_id, field_key, visible, position)
    SELECT b_projekte, f.key, f.key IN ('assignee','deadline','priority','notes','creator'), f.ord - 1
    FROM unnest(ARRAY['number','applicant','budget_title','requested_amount','approved_amount',
      'actual_amount','creator','assignee','deadline','meeting','decision_ref','instruction_date',
      'transfer_date','priority','account','finance_request','annex_a','annex_b','student_card',
      'other_pdfs','notes','applicant_note']) WITH ORDINALITY AS f(key, ord);
  INSERT INTO board_archive (board_id, enabled) VALUES (b_projekte, false);
  INSERT INTO board_numbering (board_id) VALUES (b_projekte);
  INSERT INTO board_access (board_id, user_id, access_level) VALUES (b_projekte, v_admin, 'write');
  INSERT INTO board_access (board_id, user_id, access_level) VALUES (b_projekte, v_ben, 'read');

  INSERT INTO cards (board_id, status_id, title, applicant, token, creator_user_id, deadline, priority_id, notes, position)
  SELECT b_projekte, pg_temp.st(b_projekte, col), t, '', pg_temp.demo_token(), v_anna,
    CASE WHEN off IS NOT NULL THEN to_char(today + off, 'YYYY-MM-DD') END, prio, nt, pos
  FROM (VALUES
    ('Ideen',     'Website-Relaunch planen',         30, p_low,  NULL, 0),
    ('Ideen',     'Umfrage zur Lernraumsituation',   NULL, NULL, 'Fragebogen mit Fachschaften abstimmen.', 1),
    ('In Arbeit', 'Wahlwerbung Gremienwahl',         9, p_high, NULL, 0),
    ('In Arbeit', 'Social-Media-Redaktionsplan',     3, p_mid,  NULL, 1),
    ('Review',    'Satzungsänderung Entwurf',        -1, p_high, 'Juristische Prüfung steht aus.', 0),
    ('Fertig',    'Ersti-Tüten gepackt',             -20, p_low, NULL, 0)
  ) AS v(col, t, off, prio, nt, pos);
  INSERT INTO card_assignees (card_id, user_id)
    SELECT id, CASE WHEN position = 0 THEN v_anna ELSE v_admin END FROM cards WHERE board_id = b_projekte;
  INSERT INTO card_activity (card_id, user_id, type, detail)
    SELECT id, v_anna, 'created', 'Karte erstellt' FROM cards WHERE board_id = b_projekte;

  -- ================================================================ Standorte
  -- Seed-Standorte (falls vorhanden und noch ohne Ziel) auf das Demo-Antragsboard routen.
  UPDATE locations SET target_board_id = b_antrag,
         target_status_id = pg_temp.st(b_antrag, 'Eingegangen'), enabled = true
   WHERE target_board_id IS NULL;

  -- ================================================================ Finanzen
  INSERT INTO finance_boards (name, description, owner_id)
    VALUES ('Demo Haushalt ' || to_char(today, 'YYYY'), 'Beispiel-Haushaltsplan mit Live-Auswertung', v_admin)
    RETURNING id INTO fb;
  INSERT INTO finance_board_accounts (finance_board_id, account_id) VALUES (fb, acc_allg), (fb, acc_kultur), (fb, acc_sport);
  INSERT INTO finance_board_sources (finance_board_id, board_id, expired_status_id)
    VALUES (fb, b_antrag, pg_temp.st(b_antrag, 'Abgelehnt'));
  INSERT INTO finance_board_access (finance_board_id, group_id, access_level) VALUES (fb, g_vorstand, 'read');
  INSERT INTO finance_board_access (finance_board_id, group_id, access_level) VALUES (fb, g_fin, 'write');

  INSERT INTO finance_plan_items (finance_board_id, kind, haushaltstitel, title, planned_amount, position)
    VALUES (fb, 'income', '0.1', 'Beiträge Studierendenschaft', 2500000, 0) RETURNING id INTO fp;
  INSERT INTO finance_plan_items (finance_board_id, kind, haushaltstitel, title, planned_amount, position)
    VALUES (fb, 'income', '0.2', 'Zuschüsse', 300000, 1);
  INSERT INTO finance_plan_items (finance_board_id, kind, haushaltstitel, title, planned_amount, position)
    VALUES (fb, 'expense', '1', 'Veranstaltungen', NULL, 2) RETURNING id INTO fp;
  INSERT INTO finance_plan_items (finance_board_id, parent_id, kind, haushaltstitel, title, planned_amount, position) VALUES
    (fb, fp, 'expense', '1.1 Kultur',       'Kultur',            1200000, 0),
    (fb, fp, 'expense', '1.2 Sport',        'Sport',              600000, 1),
    (fb, fp, 'expense', '1.3 Erstsemester', 'Erstsemesterarbeit', 400000, 2),
    (fb, fp, 'expense', '1.4 Exkursionen',  'Exkursionen',        300000, 3);
  INSERT INTO finance_plan_items (finance_board_id, kind, haushaltstitel, title, planned_amount, position)
    VALUES (fb, 'expense', '2', 'Verwaltung', NULL, 3) RETURNING id INTO fp;
  INSERT INTO finance_plan_items (finance_board_id, parent_id, kind, haushaltstitel, title, planned_amount, position) VALUES
    (fb, fp, 'expense', '2.1 Verwaltung', 'Druck & Büro', 200000, 0),
    (fb, fp, 'expense', '2.2 Software',   'Software',     100000, 1);

  INSERT INTO finance_templates (name, description)
    VALUES ('Demo Haushaltsvorlage', 'Beispiel: Einnahmen + Veranstaltungen + Verwaltung') RETURNING id INTO ft;
  INSERT INTO finance_template_items (template_id, kind, haushaltstitel, title, planned_amount, position)
    VALUES (ft, 'income', '0.1', 'Beiträge', NULL, 0);
  INSERT INTO finance_template_items (template_id, kind, haushaltstitel, title, planned_amount, position)
    VALUES (ft, 'expense', '1', 'Veranstaltungen', NULL, 1) RETURNING id INTO fp;
  INSERT INTO finance_template_items (template_id, parent_id, kind, haushaltstitel, title, position) VALUES
    (ft, fp, 'expense', '1.1', 'Kultur', 0), (ft, fp, 'expense', '1.2', 'Sport', 1);
  INSERT INTO finance_template_items (template_id, kind, haushaltstitel, title, position)
    VALUES (ft, 'expense', '2', 'Verwaltung', 2);

  -- ================================================================ Inventar
  INSERT INTO inventory_boards (name, description, owner_id, is_public, include_in_overview)
    VALUES ('Demo Technik-Inventar', 'Beispielinventar mit Ausleihe', v_admin, true, true)
    RETURNING id INTO inv;
  INSERT INTO inventory_board_fields (board_id, field_key, visible, position)
    SELECT inv, f.key, true, f.ord - 1
    FROM unnest(ARRAY['group','number','serial_number','category','location','condition','lendable',
      'current_holder','availability','price','purchase_date','vendor','notes']) WITH ORDINALITY AS f(key, ord);
  INSERT INTO inventory_numbering (board_id, enabled, prefix, year, code, separator, padding, next)
    VALUES (inv, true, 'INV', to_char(today, 'YYYY'), '', '-', 3, 9);
  INSERT INTO inventory_board_access (board_id, group_id, access_level) VALUES (inv, g_fin, 'read');
  INSERT INTO inventory_board_access (board_id, user_id, access_level) VALUES (inv, v_david, 'write');

  INSERT INTO inventory_options (board_id, kind, name, position) VALUES
    (inv, 'category', 'Technik', 0), (inv, 'category', 'Audio', 1), (inv, 'category', 'Möbel', 2),
    (inv, 'category', 'Geschirr', 3),
    (inv, 'location', 'Büro', 0), (inv, 'location', 'Lager Keller', 1);
  SELECT id INTO o_technik FROM inventory_options WHERE board_id = inv AND kind = 'category' AND name = 'Technik';
  SELECT id INTO o_audio   FROM inventory_options WHERE board_id = inv AND kind = 'category' AND name = 'Audio';
  SELECT id INTO o_moebel  FROM inventory_options WHERE board_id = inv AND kind = 'category' AND name = 'Möbel';
  SELECT id INTO o_buero   FROM inventory_options WHERE board_id = inv AND kind = 'location' AND name = 'Büro';
  SELECT id INTO o_lager   FROM inventory_options WHERE board_id = inv AND kind = 'location' AND name = 'Lager Keller';

  k := 'INV-' || to_char(today, 'YYYY') || '-';
  INSERT INTO inventory_items (board_id, number, name, quantity, lendable, location_id, price, purchase_date, vendor, serial_number, notes, creator_user_id)
    VALUES (inv, k || '001', 'Beamer Epson EB-W51', 1, true, o_buero, 54900, '2024-03-12', 'Elektro Müller', 'X5JK123456', NULL, v_admin) RETURNING id INTO i_beamer;
  INSERT INTO inventory_items (board_id, number, name, group_name, quantity, lendable, location_id, price, purchase_date, vendor, serial_number, creator_user_id)
    VALUES (inv, k || '002', 'Funkmikrofon', 'Funkmikrofon-Set', 1, true, o_lager, 18900, '2023-10-01', 'Thomann', 'SH-0001', v_admin) RETURNING id INTO i_mic1;
  INSERT INTO inventory_items (board_id, number, name, group_name, quantity, lendable, location_id, price, purchase_date, vendor, serial_number, creator_user_id)
    VALUES (inv, k || '003', 'Funkmikrofon', 'Funkmikrofon-Set', 1, true, o_lager, 18900, '2023-10-01', 'Thomann', 'SH-0002', v_admin) RETURNING id INTO i_mic2;
  INSERT INTO inventory_items (board_id, number, name, group_name, quantity, lendable, location_id, price, purchase_date, vendor, serial_number, creator_user_id)
    VALUES (inv, k || '004', 'Funkmikrofon', 'Funkmikrofon-Set', 1, true, o_lager, 18900, '2023-10-01', 'Thomann', 'SH-0003', v_admin) RETURNING id INTO i_mic3;
  INSERT INTO inventory_items (board_id, number, name, quantity, lendable, location_id, price, purchase_date, vendor, notes, creator_user_id)
    VALUES (inv, k || '005', 'Mehrwegbecher 0,4 l', 200, true, o_lager, 120, '2025-04-20', 'Cupforce', 'Pfand 1 € je Becher', v_admin) RETURNING id INTO i_becher;
  INSERT INTO inventory_items (board_id, number, name, quantity, lendable, location_id, price, purchase_date, vendor, creator_user_id)
    VALUES (inv, k || '006', 'PA-Lautsprecher (Paar)', 1, true, o_lager, 129900, '2022-06-15', 'Thomann', v_admin) RETURNING id INTO i_box;
  INSERT INTO inventory_items (board_id, number, name, quantity, lendable, location_id, price, purchase_date, creator_user_id)
    VALUES (inv, k || '007', 'Bierzeltgarnitur', 10, true, o_lager, 8900, '2021-05-01', v_admin) RETURNING id INTO i_tisch;
  INSERT INTO inventory_items (board_id, number, name, quantity, lendable, location_id, price, purchase_date, vendor, serial_number, condition, condition_note, creator_user_id)
    VALUES (inv, k || '008', 'Laptop ThinkPad (Büro)', 1, false, o_buero, 98900, '2020-09-01', 'Lenovo', 'PF-2A9X', 'defect', 'Display gebrochen', v_admin) RETURNING id INTO i_laptop;

  INSERT INTO inventory_item_categories (item_id, option_id) VALUES
    (i_beamer, o_technik), (i_mic1, o_audio), (i_mic2, o_audio), (i_mic3, o_audio),
    (i_becher, (SELECT id FROM inventory_options WHERE board_id = inv AND kind = 'category' AND name = 'Geschirr')),
    (i_box, o_audio), (i_box, o_technik), (i_tisch, o_moebel), (i_laptop, o_technik);
  INSERT INTO inventory_defects (item_id, description, created_by) VALUES
    (i_laptop, 'Display gebrochen, Reparatur lohnt nicht.', v_admin),
    (i_box, 'Linker Lautsprecher knackt leicht bei hoher Lautstärke.', v_ben);
  INSERT INTO inventory_defects (item_id, description, resolved_at, created_by) VALUES
    (i_beamer, 'Lampe getauscht.', now() - interval '40 days', v_admin);

  -- Leihvorgang-System-Board (wie createLoanBoardForInventory)
  INSERT INTO boards (name, description, owner_id, inventory_board_id)
    VALUES ('Leihvorgänge – Demo Technik-Inventar', 'Leihvorgänge – Demo Technik-Inventar', v_admin, inv)
    RETURNING id INTO b_loan;
  INSERT INTO board_statuses (board_id, name, position)
    SELECT b_loan, n, o - 1 FROM unnest(ARRAY['Eingegangen','In Prüfung','Vertrag bereitgestellt',
      'Vertrag unterschrieben','Ausleihe bestätigt','in Ausleihe','Zurückgegeben']) WITH ORDINALITY AS t(n, o);
  INSERT INTO board_card_fields (board_id, field_key, visible, position)
    SELECT b_loan, f.key, true, f.ord - 1
    FROM unnest(ARRAY['number','applicant','budget_title','requested_amount','approved_amount',
      'actual_amount','creator','assignee','deadline','meeting','decision_ref','instruction_date',
      'transfer_date','priority','account','finance_request','annex_a','annex_b','student_card',
      'other_pdfs','notes','applicant_note']) WITH ORDINALITY AS f(key, ord);
  INSERT INTO board_archive (board_id, enabled) VALUES (b_loan, false);
  INSERT INTO board_numbering (board_id) VALUES (b_loan);
  UPDATE inventory_boards SET loan_board_id = b_loan,
    loan_active_status_id = pg_temp.st(b_loan, 'in Ausleihe'),
    loan_returned_status_id = pg_temp.st(b_loan, 'Zurückgegeben')
  WHERE id = inv;

  -- Vorgänge: (Leit-Stück, Status, Spalte, Entleiher, Menge, Zweck, Start/Ende-Offset, öffentlich?)
  FOR i IN 1..5 LOOP
    INSERT INTO inventory_loans (item_id, status, token, borrower, borrower_email, purpose, start_date, end_date,
        requested_quantity, returned_at, notes, borrower_note, created_by)
    SELECT item, st, CASE WHEN pub THEN pg_temp.demo_token() END, who, mail, purpose,
      to_char(today + s_off, 'YYYY-MM-DD'), to_char(today + e_off, 'YYYY-MM-DD'), qty,
      CASE WHEN st = 'returned' THEN now() - interval '3 days' END, NULL, bnote,
      CASE WHEN pub THEN NULL ELSE v_admin END
    FROM (VALUES
      (1, i_beamer, 'requested',         true,  'FS Informatik',  'fsi@example.org',  'Vortragsabend',   7,  8, 1, NULL),
      (2, i_becher, 'contract_provided', true,  'Festkomitee',    'fest@example.org', 'Sommerfest',     14, 16, 120, 'Bitte Vertrag unterschrieben hochladen.'),
      (3, i_mic1,   'active',            false, 'Theatergruppe',  NULL,               'Aufführung',     -2,  5, 2, NULL),
      (4, i_tisch,  'returned',          false, 'Fachschaft Bio', NULL,               'Grillfest',     -20, -15, 6, NULL),
      (5, i_box,    'rejected',          true,  'Privatperson',   'x@example.org',    'Geburtstag',     3,  4, 1, 'Nur für studentische Veranstaltungen.')
    ) AS v(n, item, st, pub, who, mail, purpose, s_off, e_off, qty, bnote)
    WHERE v.n = i
    RETURNING id INTO l;

    -- reservierte Stücke
    IF i = 1 THEN INSERT INTO inventory_loan_items VALUES (l, i_beamer, 1);
    ELSIF i = 2 THEN INSERT INTO inventory_loan_items VALUES (l, i_becher, 120);
    ELSIF i = 3 THEN INSERT INTO inventory_loan_items VALUES (l, i_mic1, 1), (l, i_mic2, 1);
    ELSIF i = 4 THEN INSERT INTO inventory_loan_items VALUES (l, i_tisch, 6);
    ELSE INSERT INTO inventory_loan_items VALUES (l, i_box, 1);
    END IF;

    -- Tracking-Karte in der passenden Spalte
    INSERT INTO cards (board_id, status_id, title, applicant, token, notes, position)
    SELECT b_loan, pg_temp.st(b_loan, CASE lo.status
        WHEN 'requested' THEN 'Eingegangen'
        WHEN 'contract_provided' THEN 'Vertrag bereitgestellt'
        WHEN 'active' THEN 'in Ausleihe'
        WHEN 'returned' THEN 'Zurückgegeben'
        ELSE 'In Prüfung' END),
      it.name || CASE WHEN lo.requested_quantity > 1 THEN ' ×' || lo.requested_quantity ELSE '' END,
      lo.borrower, pg_temp.demo_token(), lo.purpose, 0
    FROM inventory_loans lo JOIN inventory_items it ON it.id = lo.item_id WHERE lo.id = l
    RETURNING id INTO c;
    UPDATE inventory_loans SET card_id = c WHERE id = l;
    INSERT INTO card_activity (card_id, type, detail) VALUES (c, 'created', 'Leihvorgang aus dem Inventar angelegt');
  END LOOP;

  INSERT INTO inventory_overview_config (id, min_price) VALUES (1, 10000)
    ON CONFLICT (id) DO NOTHING;

  RAISE NOTICE 'Demo-Daten angelegt: Boards % / % / % (+ Leihboard %), Finanzboard %, Inventar %',
    b_antrag, b_feedback, b_projekte, b_loan, fb, inv;
END
$demo$;

COMMIT;
