import { z } from "zod";

import { issueFilterSchema, normalizeIssueFilter, type IssueFilter } from "./issues";
import { boundedUnicodeString } from "./text";

export const issueListScopeValues = ["active", "archived", "trash"] as const;
export const issueListScopeSchema = z.enum(issueListScopeValues);

const searchTextSchema = boundedUnicodeString(
  1,
  255,
  "検索語はUnicode code pointで1〜255文字である必要があります。",
).refine((value) => value.trim().length > 0, "検索語は空白だけにできません。");

export const issueSearchQuerySchema = z
  .strictObject({
    text: searchTextSchema,
    filter: issueFilterSchema,
  })
  .transform(({ text, filter }) => ({
    text: text.trim(),
    filter: normalizeIssueFilter({ ...filter, text }),
  }));

export const recentIssueViewMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  issueId: z.string().min(1),
});

export const recentSearchMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  query: issueSearchQuerySchema,
});

export const issueSummarySchema = z.strictObject({
  id: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string(),
  statusId: z.string().min(1),
});

export const childProgressSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  canceled: z.number().int().nonnegative(),
  progressPercent: z.number().int().min(0).max(100),
});

export const recentIssueViewSchema = z.strictObject({
  issue: issueSummarySchema,
  viewedAt: z.number().int().nonnegative(),
});

export const recentSearchViewSchema = z.strictObject({
  id: z.string().min(1),
  query: issueSearchQuerySchema,
  searchedAt: z.number().int().nonnegative(),
});

export type IssueListScope = z.infer<typeof issueListScopeSchema>;
export type IssueSearchQuery = z.infer<typeof issueSearchQuerySchema>;
export type RecentIssueViewMutation = z.infer<typeof recentIssueViewMutationSchema>;
export type RecentSearchMutation = z.infer<typeof recentSearchMutationSchema>;
export type IssueSummary = z.infer<typeof issueSummarySchema>;
export type ChildProgress = z.infer<typeof childProgressSchema>;
export type RecentIssueView = z.infer<typeof recentIssueViewSchema>;
export type RecentSearchView = z.infer<typeof recentSearchViewSchema>;
export type { IssueFilter };

export const IssueListScopeSchema = issueListScopeSchema;
export const IssueSearchQuerySchema = issueSearchQuerySchema;
export const RecentIssueViewMutationSchema = recentIssueViewMutationSchema;
export const RecentSearchMutationSchema = recentSearchMutationSchema;
export const IssueSummarySchema = issueSummarySchema;
export const ChildProgressSchema = childProgressSchema;
export const RecentIssueViewSchema = recentIssueViewSchema;
export const RecentSearchViewSchema = recentSearchViewSchema;
