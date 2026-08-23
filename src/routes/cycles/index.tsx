import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";

export const Route = createFileRoute("/cycles/")({
  component: () => <OrbitApp initialSection="cycles" />,
});
