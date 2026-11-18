/**
 * Shared LIVE-PREVIEW OAuth client (server-only — NEVER import from the client).
 *
 * The sandbox serves each live preview on a dynamic `https://*.grok-sandbox.com`
 * URL, which can't be pre-registered per app. The broker instead exposes ONE
 * shared "preview" client that accepts any
 * `https://*.grok-sandbox.com/api/auth/oauth2/callback/*`
 * (broker: `app-builder-deployer/auth/src/preview-oauth.ts`).
 *
 * SECURITY — no secret is stored in this repository. The preview client
 * secret must be injected by the broker/platform via the
 * `GROK_PREVIEW_CLIENT_SECRET` environment variable (or a per-app
 * `GROK_AUTH_CLIENT_SECRET` — see `server.ts`). If no secret is injected,
 * federated sign-in is disabled (fail closed). A previous version of this
 * file contained a hardcoded shared secret; it has been removed. Removing it
 * from this file does NOT remove it from git history, so the broker-side
 * secret must still be rotated by an admin.
 *
 * `PREVIEW_CLIENT_ID` below is a public client identifier, not a secret.
 */
export const PREVIEW_CLIENT_ID = "grok_preview";

/** The shared auth broker issuer (OIDC discovery lives under it). */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/**
 * Host patterns whose callbacks the preview client accepts. Better Auth derives
 * the live preview's real origin from the request host and validates it against
 * this list (wildcard-matched), so the OAuth `redirect_uri` becomes the concrete
 * `https://<preview-host>/api/auth/oauth2/callback/...` the broker allows.
 */
export const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;
