import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { inverseIssuePatch } from "../../components/issue-undo";
import type { ToastAction, ToastState } from "../../components/ui/Toast";
import { ApiError, apiPatch, apiPost, idempotencyKey } from "../../lib/api-client";
import { syncIssueCaches } from "../../lib/queries/issue-cache";
import { queryKeys } from "../../lib/queries/keys";
import type {
  BootstrapViewModel,
  IssueDetailViewModel,
  IssueViewModel as Issue,
} from "../../shared/view-models";

export type IssueMutationVariables = {
  issue: Issue;
  patch: Partial<Issue>;
  undo?: boolean;
};
type IssueMutationRetry = IssueMutationVariables;
export type IssueReorderVariables = {
  issue: Issue;
  beforeIssueId: string | null;
  idempotencyKey: string;
  cycleId?: string;
  statusId?: string;
  projectId?: string;
};

// Issue の更新・並べ替え・ライフサイクル変更（REFACTOR-ui-architecture Phase 3b-1a）。
// Issues・Cycles・Projects・Settings・CommandPalette から使うため、features 間の依存方向を守って shell に置く。
export function useIssueActions({
  showToast,
  dismissToast,
  refresh,
}: {
  showToast: (kind: ToastState["kind"], text: string, action?: ToastAction) => void;
  dismissToast: () => void;
  refresh: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [pendingIssueId, setPendingIssueId] = useState<string | null>(null);

  const updateIssue = useMutation({
    mutationFn: ({ issue, patch }: IssueMutationVariables) =>
      apiPatch<{ issue: Issue }>(`/api/v1/issues/${issue.id}`, {
        idempotencyKey: idempotencyKey(),
        version: issue.version,
        patch,
      }),
    onMutate: async ({ issue, patch }) => {
      setPendingIssueId(issue.id);
      await queryClient.cancelQueries({ queryKey: queryKeys.bootstrap });
      const previous = queryClient.getQueryData<BootstrapViewModel>(queryKeys.bootstrap);
      const previousDetail = queryClient.getQueryData<IssueDetailViewModel>(
        queryKeys.issueDetail(issue.id),
      );
      if (previous)
        queryClient.setQueryData<BootstrapViewModel>(queryKeys.bootstrap, {
          ...previous,
          issues: previous.issues.map((item) =>
            item.id === issue.id ? { ...item, ...patch } : item,
          ),
        });
      if (previousDetail)
        queryClient.setQueryData<IssueDetailViewModel>(queryKeys.issueDetail(issue.id), {
          ...previousDetail,
          issue: { ...previousDetail.issue, ...patch },
        });
      return { previous, previousDetail };
    },
    onSuccess: ({ issue: updatedIssue }, variables) => {
      syncIssueCaches(queryClient, updatedIssue);
      for (const issueId of new Set([
        updatedIssue.id,
        variables.issue.parentId,
        updatedIssue.parentId,
      ])) {
        if (issueId)
          void queryClient.invalidateQueries({ queryKey: queryKeys.issueDetail(issueId) });
      }
      showToast(
        "success",
        variables.undo ? "元に戻しました" : "変更を保存しました",
        variables.undo
          ? undefined
          : {
              label: "元に戻す",
              onClick: () => {
                dismissToast();
                updateIssue.mutate({
                  issue: updatedIssue,
                  patch: inverseIssuePatch(variables.issue, variables.patch),
                  undo: true,
                });
              },
            },
      );
    },
    onError: async (error, variables, context) => {
      let retryIssue = variables.issue;
      if (error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT") {
        await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
        const latestIssue = queryClient
          .getQueryData<BootstrapViewModel>(queryKeys.bootstrap)
          ?.issues.find((item) => item.id === variables.issue.id);
        if (latestIssue) {
          retryIssue = latestIssue;
          syncIssueCaches(queryClient, latestIssue);
        }
      } else if (context?.previous) {
        const previousIssue = context.previous.issues.find(
          (item) => item.id === variables.issue.id,
        );
        queryClient.setQueryData<BootstrapViewModel>(queryKeys.bootstrap, (current) =>
          current && previousIssue
            ? {
                ...current,
                issues: current.issues.map((item) =>
                  item.id === previousIssue.id ? previousIssue : item,
                ),
              }
            : current,
        );
      }
      if (
        !(error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT") &&
        context?.previousDetail
      )
        queryClient.setQueryData(queryKeys.issueDetail(variables.issue.id), context.previousDetail);
      const retry = {
        issue: retryIssue,
        patch: variables.patch,
        undo: variables.undo,
      } satisfies IssueMutationRetry;
      showToast(
        "error",
        error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT"
          ? "他の場所で更新されています。最新の内容を確認してください。"
          : error instanceof ApiError
            ? error.message
            : "保存に失敗しました。",
        {
          label: "再試行",
          onClick: () => {
            dismissToast();
            updateIssue.mutate(retry);
          },
        },
      );
    },
    onSettled: () => setPendingIssueId(null),
  });

  const reorderIssueMutation = useMutation({
    mutationFn: ({
      issue,
      beforeIssueId,
      idempotencyKey: mutationKey,
      cycleId,
      statusId,
      projectId,
    }: IssueReorderVariables) =>
      apiPost<{ issue: Issue }>("/api/v1/issues/reorder", {
        idempotencyKey: mutationKey,
        issueId: issue.id,
        version: issue.version,
        beforeIssueId,
        ...(cycleId === undefined ? {} : { cycleId }),
        ...(statusId === undefined ? {} : { statusId }),
        ...(projectId === undefined ? {} : { projectId }),
      }),
    onSuccess: async ({ issue }) => {
      await refresh();
      showToast("success", `${issue.identifier} の順序を保存しました`);
    },
    onError: async (error, variables) => {
      let retryVariables = variables;
      if (error instanceof ApiError && error.code === "ISSUE_VERSION_CONFLICT") {
        await queryClient.invalidateQueries({ queryKey: queryKeys.bootstrap });
        const latestIssue = queryClient
          .getQueryData<BootstrapViewModel>(queryKeys.bootstrap)
          ?.issues.find((issue) => issue.id === variables.issue.id);
        if (latestIssue)
          retryVariables = {
            ...variables,
            issue: latestIssue,
            idempotencyKey: idempotencyKey(),
          };
      }
      showToast(
        "error",
        error instanceof ApiError ? error.message : "Issueの並び替えに失敗しました。",
        {
          label: "再試行",
          onClick: () => reorderIssueMutation.mutate(retryVariables),
        },
      );
    },
  });

  async function changeIssueLifecycle(issue: Issue, action: "archive" | "restore" | "trash") {
    await apiPost(`/api/v1/issues/${issue.id}?action=${action}`, {
      idempotencyKey: idempotencyKey(),
    });
    await refresh();
    await queryClient.invalidateQueries({ queryKey: queryKeys.issuesAll });
    showToast(
      "success",
      action === "archive"
        ? `${issue.identifier}をアーカイブしました`
        : action === "restore"
          ? `${issue.identifier}を復元しました`
          : `${issue.identifier}をゴミ箱へ移動しました`,
    );
  }

  return {
    updateIssue,
    reorderIssue: reorderIssueMutation,
    changeIssueLifecycle,
    pendingIssueId,
  };
}
