declare module "cloudflare:workers" {
  export const env: Record<string, string | undefined> & { DB?: D1Database };
}
