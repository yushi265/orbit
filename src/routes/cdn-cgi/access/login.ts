import { createFileRoute } from "@tanstack/react-router";

export function redirectAccessLogin(request: Request): Response {
  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get("returnTo");
  const target = new URL(returnTo && returnTo.startsWith("/") ? returnTo : "/", requestUrl.origin);
  return Response.redirect(target, 302);
}

export const Route = createFileRoute("/cdn-cgi/access/login")({
  server: {
    handlers: {
      GET: ({ request }) => redirectAccessLogin(request),
    },
  },
});
