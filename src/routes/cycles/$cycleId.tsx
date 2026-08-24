import { createFileRoute } from "@tanstack/react-router";
import { OrbitApp } from "../../components/OrbitApp";

export const Route = createFileRoute("/cycles/$cycleId")({
  component: () => {
    const { cycleId } = Route.useParams();
    return <OrbitApp initialSection="cycles" cycleId={cycleId} />;
  },
});
