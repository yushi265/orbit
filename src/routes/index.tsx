import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../components/OrbitApp";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

function HomeRoute() {
  return <OrbitApp initialSection="home" />;
}
