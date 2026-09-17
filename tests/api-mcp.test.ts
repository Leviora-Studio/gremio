// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Leviora Studio

import "dotenv/config";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "../lib/db";
import {
  users,
  boards,
  boardAccess,
  boardStatuses,
  boardCardFields,
  cards,
  cardActivity,
  accounts,
  priorities,
  apiTokens,
  apiTokenBoards,
  mcpClients,
  mcpTokens,
} from "../lib/db/schema";
import { generateApiToken } from "../lib/api-token";
import { env } from "../lib/env";
import {
  tokenHash,
  authorizeMcp,
  authenticateMcp,
  editMcpGrant,
  exchangeMcpToken,
  revokeMcpGrant,
  validateAuthorization,
  validRedirect,
  mcpResource,
} from "../lib/mcp-oauth";
import {
  boardCatalog,
  commentsApi,
  activityApi,
  attachmentsApi,
} from "../lib/api-card-extras";
import { GET as search } from "../app/api/v1/cards/route";
import {
  GET as getCard,
  DELETE as removeCard,
} from "../app/api/v1/cards/[id]/route";
import { POST as mcp } from "../app/api/mcp/route";
import { POST as register } from "../app/oauth/register/route";
import { POST as tokenRoute } from "../app/oauth/token/route";
import { POST as revokeRoute } from "../app/oauth/revoke/route";
import { GET as oauthMetadata } from "../app/.well-known/oauth-authorization-server/route";
import { GET as resourceMetadata } from "../app/.well-known/oauth-protected-resource/api/mcp/route";
import { callMcpTool, mcpTools } from "../lib/mcp-tools";
import { PDFDocument } from "pdf-lib";
import { createMcpDownload, downloadMcpAttachment } from "../lib/mcp-downloads";
import { attachmentTextApi } from "../lib/api-attachment-text";
import { openApiV1Spec } from "../lib/openapi-v1";

after(() => pool.end());
const params = (id: number) => ({
  params: Promise.resolve({ id: String(id) }),
});
function request(token: string, method = "GET", body?: unknown, query = "") {
  return new Request(`http://localhost:3000/api/v1/cards${query}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("MCP exposes every internal business method exactly once", () => {
  const rest = Object.entries(openApiV1Spec.paths)
    .flatMap(([path, methods]) =>
      Object.keys(methods)
        .filter((m) => ["get", "post", "patch", "delete"].includes(m))
        .map((m) => `${m.toUpperCase()} ${path}`),
    )
    .sort();
  assert.deepEqual(mcpTools.map((t) => `${t.method} ${t.path}`).sort(), rest);
  assert.equal(new Set(mcpTools.map((t) => t.name)).size, rest.length);
  for (const url of [
    "https://example.com/callback",
    "http://127.0.0.1:4000/callback",
  ])
    assert.ok(validRedirect(url));
  for (const url of [
    "javascript:alert(1)",
    "https://user:password@example.com/callback",
    "http://example.com/callback",
    "https://example.com/#fragment",
  ])
    assert.equal(validRedirect(url), false);
});

test("extended API and OAuth/MCP enforce live rights, privacy, file safety and token lifecycle", async (t) => {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/gremio_workflows_test_/,
  );
  assert.ok(
    env.UPLOAD_DIR.startsWith("/private/tmp/") ||
      env.UPLOAD_DIR.startsWith(tmpdir()),
    "Use isolated uploads only",
  );
  const suffix = `mcp-${randomUUID()}`;
  const people = await db
    .insert(users)
    .values(
      ["owner", "member", "outside"].map((n) => ({
        username: `${suffix}-${n}`,
        name: n,
      })),
    )
    .returning();
  const [owner, member, outside] = people;
  const bs = await db
    .insert(boards)
    .values([
      { name: `${suffix}-board`, ownerId: owner.id },
      { name: `${suffix}-secret-board`, ownerId: owner.id },
    ])
    .returning();
  const [board, secretBoard] = bs;
  await db.insert(boardAccess).values({ boardId: board.id, userId: member.id });
  const fields = [
    "assignee",
    "creator",
    "account",
    "priority",
    "deadline",
    "notes",
    "applicant",
    "number",
    "budget_title",
    "finance_request",
    "other_pdfs",
    "student_card",
  ];
  await db
    .insert(boardCardFields)
    .values(
      bs.flatMap((b) =>
        fields.map((fieldKey) => ({ boardId: b.id, fieldKey, visible: true })),
      ),
    );
  const statuses = await db
    .insert(boardStatuses)
    .values([
      { boardId: board.id, name: "Open", position: 0 },
      { boardId: board.id, name: "Done", position: 1 },
      { boardId: secretBoard.id, name: "Secret", position: 0 },
    ])
    .returning();
  await db
    .update(boards)
    .set({ doneStatusId: statuses[1].id })
    .where(eq(boards.id, board.id));
  const c = await db
    .insert(cards)
    .values([
      {
        boardId: board.id,
        statusId: statuses[0].id,
        title: "Event 100%",
        applicant: "Test",
        token: randomUUID(),
        notes: "hidden-needle",
        deadline: "2000-01-01",
        position: 0,
      },
      {
        boardId: board.id,
        statusId: statuses[1].id,
        title: "Done",
        applicant: "Test",
        token: randomUUID(),
        deadline: "2000-01-01",
        position: 0,
      },
      {
        boardId: secretBoard.id,
        statusId: statuses[2].id,
        title: "Secret",
        applicant: "Test",
        token: randomUUID(),
      },
    ])
    .returning();
  const [card] = c;
  const [account] = await db
    .insert(accounts)
    .values({ name: suffix })
    .returning();
  const [priority] = await db
    .insert(priorities)
    .values({ label: suffix })
    .returning();
  const makeToken = async (
    userId: number,
    scope: "read" | "write",
    boardIds?: number[],
  ) => {
    const token = generateApiToken();
    const [saved] = await db
      .insert(apiTokens)
      .values({
        userId,
        name: suffix,
        tokenHash: token.hash,
        prefix: token.prefix,
        scope,
        restricted: boardIds !== undefined,
      })
      .returning();
    if (boardIds?.length)
      await db
        .insert(apiTokenBoards)
        .values(boardIds.map((boardId) => ({ tokenId: saved.id, boardId })));
    return token.token;
  };
  const write = await makeToken(member.id, "write"),
    read = await makeToken(member.id, "read"),
    admin = await makeToken(owner.id, "write", [board.id]),
    foreign = await makeToken(outside.id, "write");
  const clientIds: string[] = [];
  try {
    await t.test(
      "catalogs are board-authorized and return no private user attributes",
      async () => {
        const data = await (
          await boardCatalog(
            request(write, "GET", undefined, "?q=member&limit=1"),
            String(board.id),
            "users",
          )
        ).json();
        assert.equal(data.users.length, 1);
        assert.deepEqual(Object.keys(data.users[0]).sort(), [
          "id",
          "name",
          "username",
        ]);
        assert.equal(
          (await boardCatalog(request(foreign), String(board.id), "users"))
            .status,
          404,
        );
        assert.equal(
          (
            await boardCatalog(
              request(admin),
              String(secretBoard.id),
              "accounts",
            )
          ).status,
          404,
        );
        assert.ok(
          (
            await (
              await boardCatalog(request(write), String(board.id), "accounts")
            ).json()
          ).accounts.some((a: { id: number }) => a.id === account.id),
        );
        assert.ok(
          (
            await (
              await boardCatalog(request(write), String(board.id), "priorities")
            ).json()
          ).priorities.some((a: { id: number }) => a.id === priority.id),
        );
      },
    );
    await t.test(
      "literal search, pagination, overdue and hidden-field filtering",
      async () => {
        const find = async (q: string) =>
          (await search(request(admin, "GET", undefined, q))).json();
        const first = await find("?limit=1");
        assert.equal(first.cards.length, 1);
        assert.equal(first.pagination.hasMore, true);
        const next = await find("?limit=1&offset=1");
        assert.notEqual(first.cards[0].id, next.cards[0].id);
        assert.equal((await find("?q=%25")).cards.length, 1);
        assert.deepEqual(
          (await find("?overdue=true")).cards.map((x: { id: number }) => x.id),
          [card.id],
        );
        assert.equal((await find("?q=hidden-needle")).cards.length, 1);
        await db
          .update(boardCardFields)
          .set({ visible: false })
          .where(
            and(
              eq(boardCardFields.boardId, board.id),
              eq(boardCardFields.fieldKey, "notes"),
            ),
          );
        assert.equal((await find("?q=hidden-needle")).cards.length, 0);
        await db
          .update(boardCardFields)
          .set({ visible: false })
          .where(
            and(
              eq(boardCardFields.boardId, board.id),
              eq(boardCardFields.fieldKey, "deadline"),
            ),
          );
        assert.equal((await find("?overdue=true")).cards.length, 0);
        await db
          .update(boardCardFields)
          .set({ visible: true })
          .where(
            and(
              eq(boardCardFields.boardId, board.id),
              eq(boardCardFields.fieldKey, "deadline"),
            ),
          );
        await db
          .update(cards)
          .set({ deadline: null })
          .where(eq(cards.id, card.id));
        assert.ok(
          (await find("?overdue=false")).cards.some(
            (c: { id: number }) => c.id === card.id,
          ),
        );
        await db
          .update(boardCardFields)
          .set({ visible: false })
          .where(
            and(
              eq(boardCardFields.boardId, board.id),
              eq(boardCardFields.fieldKey, "deadline"),
            ),
          );
        for (const q of [
          "?limit=101",
          "?offset=-1",
          "?deadlineBefore=2026-02-30",
          "?overdue=yes",
          "?unknown=x",
        ])
          assert.equal(
            (await search(request(write, "GET", undefined, q))).status,
            400,
          );
      },
    );
    await t.test(
      "comment ownership and immutable/redacted activity",
      async () => {
        assert.equal(
          (
            await commentsApi(
              request(read, "POST", { body: "no" }),
              String(card.id),
            )
          ).status,
          403,
        );
        const result = await (
          await commentsApi(
            request(write, "POST", { body: "Discussion" }),
            String(card.id),
          )
        ).json();
        const id = String(result.comment.id);
        assert.equal(
          (
            await commentsApi(
              request(admin, "PATCH", { body: "overwrite" }),
              String(card.id),
              id,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await commentsApi(
              request(write, "PATCH", { body: "Edited" }),
              String(card.id),
              id,
            )
          ).status,
          200,
        );
        assert.equal(
          (
            await commentsApi(
              request(write, "PATCH", { body: "Wrong card" }),
              String(c[1].id),
              id,
            )
          ).status,
          404,
        );
        assert.equal(
          (await commentsApi(request(admin, "DELETE"), String(card.id), id))
            .status,
          200,
        );
        await db.insert(cardActivity).values([
          { cardId: card.id, type: "deadline", detail: "private deadline" },
          {
            cardId: card.id,
            type: "archive",
            detail: "https://secret.example/path",
          },
          {
            cardId: card.id,
            type: "attachment_added",
            detail: "secret-student-name.pdf",
          },
        ]);
        const activity = await (
          await activityApi(request(write), String(card.id))
        ).text();
        for (const secret of [
          "private deadline",
          "secret.example",
          "secret-student-name",
        ])
          assert.ok(!activity.includes(secret));
      },
    );
    await t.test(
      "uploads, replacements, scope restrictions and hidden attachment downloads",
      async () => {
        const upload = (token: string, kind: string, text: string) => {
          const data = new FormData();
          data.set("kind", kind);
          data.set(
            "file",
            new File([text], "Antrag.pdf", { type: "application/pdf" }),
          );
          return attachmentsApi(
            new Request("http://localhost:3000/api/v1", {
              method: "POST",
              headers: { authorization: `Bearer ${token}` },
              body: data,
            }),
            String(card.id),
          );
        };
        assert.equal(
          (await upload(read, "finance_request", "denied")).status,
          403,
        );
        const a = await (
          await upload(write, "finance_request", "%PDF-test")
        ).json();
        assert.ok(a.attachment.id);
        assert.equal("path" in a.attachment, false);
        const download = await attachmentsApi(
          request(write),
          String(card.id),
          String(a.attachment.id),
        );
        assert.equal(await download.text(), "%PDF-test");
        assert.equal(download.headers.get("cache-control"), "no-store");
        const b = await (
          await upload(write, "finance_request", "%PDF-replaced")
        ).json();
        assert.equal(
          (
            await attachmentsApi(
              request(write),
              String(card.id),
              String(a.attachment.id),
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await attachmentsApi(
              request(write),
              String(c[1].id),
              String(b.attachment.id),
            )
          ).status,
          404,
        );
        await db
          .update(boardCardFields)
          .set({ visible: false })
          .where(
            and(
              eq(boardCardFields.boardId, board.id),
              eq(boardCardFields.fieldKey, "finance_request"),
            ),
          );
        assert.equal(
          (
            await attachmentsApi(
              request(write),
              String(card.id),
              String(b.attachment.id),
            )
          ).status,
          404,
        );
        assert.equal(
          (await upload(write, "finance_request", "no")).status,
          400,
        );
        const list = await (
          await attachmentsApi(request(write), String(card.id))
        ).json();
        assert.equal(list.attachments.length, 0);
      },
    );
    let access = "",
      refresh = "",
      grantId = "",
      authRequest: Record<string, string>;
    const verifier = "v".repeat(43),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    const resource = mcpResource();
    const exchange = (code: string, extra: Record<string, string> = {}) =>
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientIds[0],
        redirect_uri: "https://agent.example/callback",
        code_verifier: verifier,
        resource,
        ...extra,
      });
    await t.test(
      "OAuth discovery, registration, redirect matching and PKCE",
      async () => {
        assert.equal(
          (await (await resourceMetadata()).json()).resource,
          resource,
        );
        assert.deepEqual(
          (await (await oauthMetadata()).json())
            .code_challenge_methods_supported,
          ["S256"],
        );
        const res = await register(
          new Request("http://localhost:3000/oauth/register", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              client_name: "Test agent",
              redirect_uris: ["https://agent.example/callback"],
            }),
          }),
        );
        assert.equal(res.status, 201);
        clientIds.push((await res.json()).client_id);
        authRequest = {
          response_type: "code",
          client_id: clientIds[0],
          redirect_uri: "https://agent.example/callback",
          code_challenge: challenge,
          code_challenge_method: "S256",
          resource,
          scope: "gremio",
          state: "state-value",
        };
        assert.equal(
          await validateAuthorization({
            ...authRequest,
            redirect_uri: "https://evil.example/callback",
          }),
          null,
        );
        assert.equal(
          await validateAuthorization({
            ...authRequest,
            code_challenge_method: "plain",
          }),
          null,
        );
        await assert.rejects(() =>
          authorizeMcp(member, authRequest, {
            scope: "write",
            allBoards: false,
            boardIds: [secretBoard.id],
          }),
        );
        const destination = new URL(
          await authorizeMcp(owner, authRequest, {
            scope: "read",
            allBoards: false,
            boardIds: [board.id],
          }),
        );
        assert.equal(destination.searchParams.get("state"), "state-value");
        const code = destination.searchParams.get("code")!;
        assert.equal(
          await exchangeMcpToken(
            exchange(code, { code_verifier: "x".repeat(43) }),
          ),
          null,
        );
        assert.equal(
          await exchangeMcpToken(
            exchange(code, { resource: "https://other.example/mcp" }),
          ),
          null,
        );
        assert.equal(
          await exchangeMcpToken(
            exchange(code, { redirect_uri: "https://evil.example/callback" }),
          ),
          null,
        );
        const tokens = await exchangeMcpToken(exchange(code));
        assert.ok(tokens);
        access = tokens.access_token;
        refresh = tokens.refresh_token;
        const [stored] = await db
          .select()
          .from(mcpTokens)
          .where(eq(mcpTokens.hash, tokenHash(access)));
        grantId = stored.grantId;
        assert.equal(
          (await getCard(request(access), params(card.id))).status,
          401,
          "MCP credentials must not authenticate REST",
        );
        assert.equal(
          (await authenticateMcp(`Bearer ${access}`))!.scope,
          "read",
        );
      },
    );
    await t.test(
      "MCP transport/tool parity and live permission changes",
      async () => {
        const call = async (
          method: string,
          p: unknown = {},
          token = access,
          origin?: string,
        ) =>
          mcp(
            new Request(resource, {
              method: "POST",
              headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
                accept: "application/json, text/event-stream",
                ...(origin ? { origin } : {}),
              },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method,
                params: p,
              }),
            }),
          );
        assert.equal((await call("tools/list", {}, write)).status, 401);
        assert.equal(
          (await call("tools/list", {}, access, "https://evil.example")).status,
          403,
        );
        const init = await (
          await call("initialize", {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "test", version: "1" },
          })
        ).json();
        assert.ok(init.result.serverInfo);
        const list = await (await call("tools/list")).json();
        assert.equal(list.result.tools.length, mcpTools.length);
        const info = await (
          await call("tools/call", { name: "get_api_info", arguments: {} })
        ).json();
        assert.equal(info.result.structuredContent.token.scope, "read");
        const denied = await (
          await call("tools/call", {
            name: "add_comment",
            arguments: { id: card.id, data: { body: "denied" } },
          })
        ).json();
        assert.equal(denied.result.isError, true);
        await editMcpGrant(owner, grantId, {
          scope: "write",
          allBoards: false,
          boardIds: [board.id],
        });
        const allowed = await (
          await call("tools/call", {
            name: "add_comment",
            arguments: { id: card.id, data: { body: "MCP comment" } },
          })
        ).json();
        assert.equal(allowed.result.isError, false);
        const ctx = (await authenticateMcp(`Bearer ${access}`))!;
        const pdf = await PDFDocument.create();
        const pdfPage = pdf.addPage(); pdfPage.drawText("Testantrag");
        const field = pdf.getForm().createTextField("Antragsteller"); field.setText("Anna Test"); field.addToPage(pdfPage);
        const pdfBytes = Buffer.from(await pdf.save());
        const uploaded = await callMcpTool(ctx, "upload_attachment", {
          id: card.id,
          kind: "other",
          filename: "Test.pdf",
          mime: "application/pdf",
          dataBase64: pdfBytes.toString("base64"),
        });
        assert.equal(uploaded.isError, false);
        const aid = (
          uploaded.structuredContent as { attachment: { id: number } }
        ).attachment.id;
        const downloaded = await callMcpTool(ctx, "download_attachment", {
          id: card.id,
          attachmentId: aid,
        });
        assert.equal(downloaded.content[0].type, "resource_link");
        const link = downloaded.structuredContent as { url: string; expiresAt: string };
        assert.equal(JSON.stringify(downloaded).includes('"blob"'), false);
        assert.equal(link.url.includes(access), false, "no reusable OAuth token in URL");
        const download = (url = link.url, cid = card.id, attachmentId = aid) => downloadMcpAttachment(new Request(url), String(cid), String(attachmentId));
        const binary = await download();
        assert.equal(binary.status, 200); assert.equal(binary.headers.get("content-type"), "application/pdf");
        assert.match(binary.headers.get("content-disposition")!, /attachment;/);
        assert.equal(binary.headers.get("referrer-policy"), "no-referrer");
        assert.deepEqual(Buffer.from(await binary.arrayBuffer()), pdfBytes);
        assert.equal((await download(resource)).status, 404);
        assert.equal((await download(link.url, c[1].id)).status, 404, "ticket is bound to card");
        assert.equal((await download(link.url, card.id, aid + 1)).status, 404, "ticket is bound to attachment");
        const tampered = new URL(link.url); const ticket = tampered.searchParams.get("ticket")!;
        tampered.searchParams.set("ticket", (ticket[0] === "A" ? "B" : "A") + ticket.slice(1));
        assert.equal((await download(tampered.toString())).status, 404);
        const expired = await createMcpDownload({ ...ctx, accessTokenExpiresAt: new Date(Date.now() - 1) }, card.id, aid);
        assert.ok(!(expired instanceof Response));
        assert.equal((await download(expired.url)).status, 404);
        const text = await callMcpTool(ctx, "read_attachment_text", { id: card.id, attachmentId: aid });
        assert.equal(text.isError, false);
        assert.match(String(text.structuredContent!.text), /Antragsteller: Anna Test/);
        assert.equal((await attachmentTextApi(request(read), String(card.id), String(aid))).status, 200, "REST read tokens can extract text too");
        await db.update(boardCardFields).set({ visible: false }).where(and(eq(boardCardFields.boardId, board.id), eq(boardCardFields.fieldKey, "other_pdfs")));
        assert.equal((await download()).status, 404, "field visibility is live");
        assert.equal((await attachmentTextApi(request(read), String(card.id), String(aid))).status, 404);
        await db.update(boardCardFields).set({ visible: true }).where(and(eq(boardCardFields.boardId, board.id), eq(boardCardFields.fieldKey, "other_pdfs")));
        await editMcpGrant(owner, grantId, {
          scope: "read",
          allBoards: false,
          boardIds: [],
        });
        const empty = await (
          await call("tools/call", { name: "list_boards", arguments: {} })
        ).json();
        assert.deepEqual(empty.result.structuredContent.boards, []);
        assert.equal((await download()).status, 404, "grant restrictions are live");
        await editMcpGrant(owner, grantId, {
          scope: "read",
          allBoards: false,
          boardIds: [board.id],
        });
        assert.equal((await download()).status, 200);
        await db.update(users).set({ isActive: false }).where(eq(users.id, owner.id));
        assert.equal((await download()).status, 404, "user deactivation is live");
        await db.update(users).set({ isActive: true }).where(eq(users.id, owner.id));
        await db.update(mcpTokens).set({ expiresAt: new Date(Date.now() - 1) }).where(eq(mcpTokens.hash, tokenHash(access)));
        assert.equal((await download()).status, 404, "access-token expiry is live");
        await db.update(mcpTokens).set({ expiresAt: new Date(Date.now() + 60_000) }).where(eq(mcpTokens.hash, tokenHash(access)));
      },
    );
    await t.test(
      "rotating refresh tokens, replay detection and revocation",
      async () => {
        const p = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: clientIds[0],
          resource,
        });
        const response = await tokenRoute(
          new Request("http://localhost:3000/oauth/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: p,
          }),
        );
        assert.equal(response.status, 200);
        const rotated = await response.json();
        assert.notEqual(rotated.refresh_token, refresh);
        assert.equal(
          (await authenticateMcp(`Bearer ${rotated.access_token}`))!.scope,
          "read",
        );
        assert.equal(
          await exchangeMcpToken(p),
          null,
          "old refresh cannot be reused",
        );
        assert.equal(
          await authenticateMcp(`Bearer ${rotated.access_token}`),
          null,
          "replay revokes grant",
        );
        const code = new URL(
          await authorizeMcp(owner, authRequest!, {
            scope: "read",
            allBoards: false,
            boardIds: [board.id],
          }),
        ).searchParams.get("code")!;
        const tokens = (await exchangeMcpToken(exchange(code)))!;
        const revoke = await revokeRoute(
          new Request("http://localhost:3000/oauth/revoke", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              token: tokens.access_token,
              client_id: clientIds[0],
            }),
          }),
        );
        assert.equal(revoke.status, 200);
        assert.equal(
          await authenticateMcp(`Bearer ${tokens.access_token}`),
          null,
        );
        assert.equal(await exchangeMcpToken(exchange(code)), null);
      },
    );
    await t.test(
      "parallel code and refresh redemption cannot issue multiple token pairs",
      async () => {
        const issue = async () =>
          new URL(
            await authorizeMcp(owner, authRequest!, {
              scope: "read",
              allBoards: false,
              boardIds: [board.id],
            }),
          ).searchParams.get("code")!;
        const code = await issue();
        const exchanged = await Promise.all([
          exchangeMcpToken(exchange(code)),
          exchangeMcpToken(exchange(code)),
        ]);
        assert.equal(exchanged.filter(Boolean).length, 1);
        const first = exchanged.find(Boolean)!;
        assert.equal(
          await authenticateMcp(`Bearer ${first.access_token}`),
          null,
          "code replay revokes issued credentials",
        );
        const fresh = (await exchangeMcpToken(exchange(await issue())))!;
        const form = new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: fresh.refresh_token,
          client_id: clientIds[0],
          resource,
        });
        const rotated = await Promise.all([
          exchangeMcpToken(form),
          exchangeMcpToken(form),
        ]);
        assert.equal(rotated.filter(Boolean).length, 1);
        assert.equal(
          await authenticateMcp(
            `Bearer ${rotated.find(Boolean)!.access_token}`,
          ),
          null,
        );
      },
    );
    await t.test(
      "deactivated users and deleted restriction boards never widen access",
      async () => {
        const code = new URL(
          await authorizeMcp(owner, authRequest!, {
            scope: "read",
            allBoards: false,
            boardIds: [secretBoard.id],
          }),
        ).searchParams.get("code")!;
        const issued = (await exchangeMcpToken(exchange(code)))!;
        await db
          .update(users)
          .set({ isActive: false })
          .where(eq(users.id, owner.id));
        assert.equal(
          await authenticateMcp(`Bearer ${issued.access_token}`),
          null,
        );
        await db
          .update(users)
          .set({ isActive: true })
          .where(eq(users.id, owner.id));
        await db.delete(boards).where(eq(boards.id, secretBoard.id));
        const ctx = (await authenticateMcp(`Bearer ${issued.access_token}`))!;
        assert.equal(ctx.boardIds!.size, 0);
        const result = await callMcpTool(ctx, "list_boards", {});
        assert.deepEqual(result.structuredContent!.boards, []);
      },
    );
    await t.test(
      "live membership removal and expired access tokens",
      async () => {
        const code = new URL(
          await authorizeMcp(member, authRequest!, {
            scope: "write",
            allBoards: false,
            boardIds: [board.id],
          }),
        ).searchParams.get("code")!;
        const tokens = (await exchangeMcpToken(exchange(code)))!;
        await db.delete(boardAccess).where(eq(boardAccess.userId, member.id));
        const result = await callMcpTool(
          (await authenticateMcp(`Bearer ${tokens.access_token}`))!,
          "get_card",
          { id: card.id },
        );
        assert.equal(result.isError, true);
        await db
          .update(mcpTokens)
          .set({ expiresAt: new Date(0) })
          .where(eq(mcpTokens.hash, tokenHash(tokens.access_token)));
        assert.equal(
          await authenticateMcp(`Bearer ${tokens.access_token}`),
          null,
        );
        await revokeMcpGrant(owner.id, grantId);
      },
    );
  } finally {
    // Remove test files via the authorized API before deleting fixture boards.
    await removeCard(request(admin, "DELETE"), params(card.id));
    for (const row of c)
      await rm(join(env.UPLOAD_DIR, "cards", String(row.id)), {
        recursive: true,
        force: true,
      });
    if (clientIds.length)
      await db.delete(mcpClients).where(inArray(mcpClients.id, clientIds));
    await db.delete(boards).where(
      inArray(
        boards.id,
        bs.map((b) => b.id),
      ),
    );
    await db.delete(users).where(
      inArray(
        users.id,
        people.map((p) => p.id),
      ),
    );
    await db.delete(accounts).where(eq(accounts.id, account.id));
    await db.delete(priorities).where(eq(priorities.id, priority.id));
  }
});
