import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../components/OrbitApp";

export const Route = createFileRoute("/search")({
  component: () => <OrbitApp initialSection="search" />,
});
