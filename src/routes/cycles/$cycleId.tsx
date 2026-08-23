import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";

export const Route = createFileRoute("/cycles/$cycleId")({
  component: () => <OrbitApp initialSection="cycles" />,
});
