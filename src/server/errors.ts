export type ErrorCode =
  | "AUTH_REQUIRED"
  | "VALIDATION_ERROR"
  | "RESOURCE_NOT_FOUND"
  | "ISSUE_VERSION_CONFLICT"
  | "IDEMPOTENCY_KEY_REUSED"
  | "OPERATION_IN_PROGRESS"
  | "RUN_REQUIRES_RESUME"
  | "BACKGROUND_RUN_REJECTED"
  | "INTERNAL_ERROR";

export class ServiceError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: number,
    code: ErrorCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export function notFound(message = "対象が見つかりません。"): ServiceError {
  return new ServiceError(404, "RESOURCE_NOT_FOUND", message);
}

export function validationError(fieldErrors: Record<string, string[]>): ServiceError {
  return new ServiceError(400, "VALIDATION_ERROR", "入力内容を確認してください。", fieldErrors);
}

export function conflict(
  code:
    | "ISSUE_VERSION_CONFLICT"
    | "IDEMPOTENCY_KEY_REUSED"
    | "RUN_REQUIRES_RESUME"
    | "BACKGROUND_RUN_REJECTED",
  message: string,
): ServiceError {
  return new ServiceError(409, code, message);
}

export function locked(message = "バックグラウンド処理中のため変更できません。"): ServiceError {
  return new ServiceError(423, "OPERATION_IN_PROGRESS", message);
}
