export type TransportFailure = {
  status?: number;
  offline?: boolean;
  timeout?: boolean;
};

export type TransportFailureKind =
  | "auth_required"
  | "offline"
  | "timeout"
  | "server_error"
  | "network_error";

export function classifyTransportFailure(failure: TransportFailure): TransportFailureKind {
  if (failure.offline) return "offline";
  if (failure.timeout || failure.status === 408 || failure.status === 504) {
    return "timeout";
  }
  if (failure.status === 401) return "auth_required";
  if (failure.status !== undefined && failure.status >= 500) {
    return "server_error";
  }
  return "network_error";
}

export const classifyTransportError = classifyTransportFailure;
