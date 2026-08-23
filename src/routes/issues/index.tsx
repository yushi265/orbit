import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";

export const Route = createFileRoute("/issues/")({
  component: () => <OrbitApp initialSection="issues" />,
});
