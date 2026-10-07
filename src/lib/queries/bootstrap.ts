import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { BootstrapViewModel } from "../../shared/view-models";
import { apiGet } from "../api-client";
import { queryKeys } from "./keys";

export function useBootstrap<T>(select: (data: BootstrapViewModel) => T): UseQueryResult<T> {
  return useQuery({
    queryKey: queryKeys.bootstrap,
    queryFn: () => apiGet<BootstrapViewModel>("/api/v1/bootstrap"),
    select,
  });
}
