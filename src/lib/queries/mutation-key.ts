import { useRef } from "react";
import { idempotencyKey } from "../api-client";

// 冪等キーの保持。同じ signature の再試行では同じキーを返し、signature が変わるか reset() で新しいキーにする。
// どの結果でキーを捨てるか（reset）は、409 / 423 などの扱いが画面ごとに違うため呼び出し側が決める。
export function useMutationKey(): { keyFor(signature: string): string; reset(): void } {
  const held = useRef<{ key: string; signature: string } | null>(null);
  const api = useRef({
    keyFor(signature: string) {
      if (held.current?.signature !== signature)
        held.current = { key: idempotencyKey(), signature };
      return held.current.key;
    },
    reset() {
      held.current = null;
    },
  });
  return api.current;
}
