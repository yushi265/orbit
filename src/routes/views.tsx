import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../components/OrbitApp";
import { normalizeViewSearch } from "../components/saved-views";

export const Route = createFileRoute("/views")({
  validateSearch: normalizeViewSearch,
  component: ViewsRoute,
});
function ViewsRoute() {
  return <OrbitApp initialSection="views" viewSearch={Route.useSearch()} />;
}
