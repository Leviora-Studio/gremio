# Gremio MCP

Gremio exposes its complete authenticated boards/cards API through the integrated
MCP endpoint at `APP_BASE_URL/api/mcp`. It uses the official TypeScript SDK and
stateless Streamable HTTP with JSON responses. No separate process or API key is
needed for MCP. The public application/feedback API is not part of this endpoint.

## Connect and manage access

1. Add the MCP URL in an application supporting Streamable HTTP and OAuth with
   dynamic client registration (public client, authorization code, PKCE S256).
2. The application opens Gremio. If necessary, Gremio uses its existing OIDC login.
3. On Gremio's consent page, choose **Nur lesen** (default) or **Lesen und schreiben**
   and explicitly select boards. No boards are preselected. **Alle meine Boards,
   einschließlich zukünftiger** is a separate opt-in.
4. Approve the connection. No upstream OIDC token is given to the application.
5. Manage permissions or revoke the connection under **Mein Konto → Verbundene
   Anwendungen** (`/intern/konto/verbindungen`). Saving confirms any expansion.

Writing includes deleting cards and permitted comments and replacing named file
slots. Visibility rules apply to notes, financial fields and attachments,
including student ID documents: these require an authorized internal connection
and an enabled field. These files never become public through MCP.

The OAuth resource scope is `gremio`. Read/write and board restrictions are
**live application permissions attached to the grant**, not a set of fixed
per-board OAuth scope strings. Every tool execution reads this grant again, then
uses the same REST handlers and live board access checks. Consequently changes
apply to subsequent calls even with an existing access token. A running operation
is not rolled back when a permission is revoked. Token refresh never changes the
grant. An empty restricted board selection means no board access, including after
all selected boards have been deleted. It never means unrestricted access.

## Protocol and authentication

- MCP endpoint: `/api/mcp` (POST); authenticated GET/DELETE return 405 because no
  long-lived sessions or event stream are used. Unauthenticated requests expose
  the resource metadata URL in `WWW-Authenticate`.
- Resource metadata: `/.well-known/oauth-protected-resource/api/mcp` (also at the
  root protected-resource metadata URL).
- Authorization server metadata: `/.well-known/oauth-authorization-server`.
- Registration: `/oauth/register`; exact pre-registered redirects, HTTPS or local
  loopback HTTP only; no client secret. Registration is rate- and size-limited.
- Authorization: `/oauth/authorize`; explicit consent on every new connection,
  existing OIDC login, account-bound consent form expiring after ten minutes,
  Next Server Action origin/CSRF protection. Application names are self-declared;
  the consent screen also shows the redirect origin.
- Token endpoint: `/oauth/token`; authorization-code exchange requires the same
  client, redirect, resource and S256 verifier. Codes expire after five minutes
  and can be used once. Access tokens expire after 15 minutes.
- Refresh tokens rotate at every use, expire after 30 days, and cannot be reused.
  Replay revokes the connection. Concurrent reuse can therefore require reconnecting;
  clients must serialize refresh. Only credential hashes are stored.
- Revocation: `/oauth/revoke`; revokes the entire connection associated with a
  matching client/token. Account UI revocation has the same effect.
- Expired credentials are cleaned at startup and hourly. Consumed refresh records
  remain until expiry so replay can be detected. Revoked connections remain as
  records but are not shown as active.

MCP tokens are issued only for the canonical MCP resource and cannot authenticate
`/api/v1`. Personal `grm_` API tokens likewise cannot authenticate `/api/mcp`.
Internal MCP dispatch attaches a non-serializable context to a server-created
Request and calls the existing REST handler; it does not forward OAuth tokens to
REST or bypass authorization by manufacturing HTTP headers.

## Tools and files

All 21 business method/path combinations have a corresponding MCP tool, verified
by a contract test. This includes discovery, boards, catalogs, filtered/paginated
card lists, card creation/update/deletion, comments, immutable activity and files.
MCP lists always request pagination; use `pagination.hasMore` and increase `offset`.
For card fields use the REST conventions: integer cents, YYYY-MM-DD dates,
complete replacement arrays for assignments and budget positions, and a current
`budgetRevision` when changing positions. Moving a card may trigger archive/date
workflows. Non-idempotent operations must not be blindly retried after timeouts.

`upload_attachment` accepts one file as Base64 with filename, MIME and kind (up to
25 MiB decoded). It does not accept arbitrary local paths or fetch remote URLs.
`download_attachment` returns an embedded binary MCP resource with the original
MIME type. A client must support binary resources and sufficiently large messages;
Gremio does not parse/OCR documents or bypass client attachment limits. The protected
REST download path in metadata is not a public download URL and does not accept
MCP tokens. Use the download tool for MCP access.

Tool annotations identify reads and potentially destructive writes. They are
hints for the host application's UI, not permission enforcement or a guarantee
that the application will ask for confirmation. Card/comment/file content is
untrusted data, never an instruction to execute additional operations.

## Deployment

Apply `0065_mcp_oauth.sql` through `npm run db:migrate` (or the existing container
startup migrations), after a normal database backup. No new environment secrets
are needed. `APP_BASE_URL` must be the canonical HTTPS origin in production, and
the reverse proxy must expose `/api/mcp`, `/oauth/*` and `/.well-known/*` on that
origin. The existing OIDC callback stays `/api/auth/callback`; the upstream login
provider does not need to register each AI application.

Allow at least 36 MiB JSON request bodies at the reverse proxy for the maximum
Base64 file upload; Gremio additionally bounds the body while reading. Normal REST
multipart uploads require 25 MiB plus envelope overhead. Configure suitable proxy
timeouts for existing archive-triggered operations. Avoid logging authorization
headers, form bodies, authorization codes or complete OAuth callback query strings.

Current interoperability target: desktop/server-side MCP clients using DCR and
PKCE. Client metadata documents, confidential client secrets, legacy SSE and
cross-origin browser-only clients are not implemented. Requests carrying a foreign
Origin are rejected; no wildcard credentialed CORS is enabled. Test the intended
client with the actual HTTPS reverse proxy before release.

See `docs/API.md` for the REST contract. Finance/inventory management,
PDF editing/signing and board administration remain outside both interfaces.

## Verification

`tests/api-mcp.test.ts` runs against an isolated `gremio_workflows_test_*` database
and a temporary upload directory. It covers REST/MCP method parity, field privacy,
catalogs, comments, attachment replacement/download, PKCE, resources, live grants,
refresh rotation/replay and revocation. `tests/browser/mcp-production.cjs` checks
the actual production server and browser consent/management with synthetic users
and a local mock OIDC provider. It never contacts a real identity provider or cloud.
