import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../components/OrbitApp";

export const Route = createFileRoute("/views")({
  component: () => <OrbitApp initialSection="views" />,
});
