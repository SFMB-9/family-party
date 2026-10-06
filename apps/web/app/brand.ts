/**
 * The game's display name: logos, page titles, link previews, share text.
 * Try another name without touching code by setting NEXT_PUBLIC_BRAND_NAME (apps/web/.env.local,
 * or the Vercel project's env vars + a redeploy). Repo, packages and AWS resources keep "family-party".
 */
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Sobremesa";
