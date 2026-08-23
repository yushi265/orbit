import { z } from "zod";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().refine(Number.isFinite, { message: "有限数である必要があります。" }),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export interface TiptapMark {
  type: string;
  attrs?: Record<string, JsonValue>;
}

export interface TiptapNode {
  type: string;
  attrs?: Record<string, JsonValue>;
  content?: TiptapNode[];
  marks?: TiptapMark[];
  text?: string;
}

const tiptapMarkSchema: z.ZodType<TiptapMark> = z
  .object({
    type: z.string().min(1),
    attrs: z.record(z.string(), jsonValueSchema).optional(),
  })
  .strict();

export const tiptapNodeSchema: z.ZodType<TiptapNode> = z.lazy(() =>
  z
    .object({
      type: z.string().min(1),
      attrs: z.record(z.string(), jsonValueSchema).optional(),
      content: z.array(tiptapNodeSchema).optional(),
      marks: z.array(tiptapMarkSchema).optional(),
      text: z.string().optional(),
    })
    .strict()
    .superRefine((node, context) => {
      if (node.type === "text" && node.text === undefined) {
        context.addIssue({ code: "custom", message: "text node には text が必要です。" });
      }
      if (node.type !== "text" && node.text !== undefined) {
        context.addIssue({ code: "custom", message: "text 以外の node は text を持てません。" });
      }
    }),
);

export const tiptapDocumentSchema = z
  .object({
    type: z.literal("doc"),
    content: z.array(tiptapNodeSchema).default([]),
  })
  .strict();

export type TiptapDocument = z.infer<typeof tiptapDocumentSchema>;
export const TiptapDocumentSchema = tiptapDocumentSchema;
