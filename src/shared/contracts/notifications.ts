import { z } from "zod";

export const notificationReadMutationSchema = z.strictObject({
  idempotencyKey: z.string().min(1),
  read: z.boolean(),
});

export type NotificationReadMutation = z.infer<typeof notificationReadMutationSchema>;

export const NotificationReadMutationSchema = notificationReadMutationSchema;
