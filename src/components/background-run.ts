import { useEffect, useRef, useState } from "react";
import { ApiError, apiGet, apiPost, idempotencyKey } from "../lib/api-client";
import type { PublicRunViewModel as Run } from "../shared/view-models";

const CURRENT_INTERVAL_MS = 30_000;
const CHUNK_YIELD_MS = 100;
const NO_PROGRESS_DELAY_MS = 5_000;

type Callbacks = {
  onSucceeded: () => void;
  onError: (error: unknown) => void;
};
type Events = Callbacks & {
  onRun: (run: Run | null) => void;
  onBusy: (busy: boolean) => void;
};
type ContinueResponse = {
  run: Run;
  next: "continue" | "resume" | "none";
};

function active(run: Run | null): run is Run & { status: "pending" | "running" } {
  return run?.status === "pending" || run?.status === "running";
}

/** Serializes status reads and mutations so an older HTTP snapshot cannot replace progress. */
function createRunner(events: Events) {
  let current: Run | null = null;
  let initialized = false;
  let disposed = false;
  let inFlight = false;
  let revalidateQueued = false;
  let shouldContinue = false;
  let nextDelay = CHUNK_YIELD_MS;
  let chunkTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const notifiedRuns = new Set<string>();

  function publish(run: Run | null) {
    if (disposed) return;
    current = run;
    events.onRun(run);
    if (run?.status === "succeeded" && !notifiedRuns.has(run.run_id)) {
      notifiedRuns.add(run.run_id);
      events.onSucceeded();
    }
  }

  function clearChunkTimer() {
    if (chunkTimer !== undefined) clearTimeout(chunkTimer);
    chunkTimer = undefined;
  }

  async function readCurrent() {
    try {
      const result = await apiGet<{ run: Run | null }>("/api/v1/background-runs/current");
      if (disposed) return;
      // /current omits terminal runs; check the known Run before reporting completion.
      const run =
        result.run ??
        (current && ["pending", "running", "paused", "failed"].includes(current.status)
          ? (await apiGet<{ run: Run }>(`/api/v1/background-runs/${current.run_id}`)).run
          : null);
      if (disposed) return;
      publish(run);
      shouldContinue = active(run);
      nextDelay = CHUNK_YIELD_MS;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        publish(null);
        shouldContinue = false;
        return;
      }
      throw error;
    }
  }

  async function perform(task: () => Promise<void>, reportError: boolean) {
    if (disposed || inFlight) return;
    inFlight = true;
    clearChunkTimer();
    events.onBusy(true);
    try {
      await task();
    } catch (error) {
      if (disposed) return;
      if (reportError) events.onError(error);
      // A lost response may have committed or lost its Lease. Read Server truth now;
      // further attempts wait for the periodic/focus/online revalidation.
      if (reportError) {
        try {
          await readCurrent();
        } catch {
          // Retain the last known overlay while offline. Polling remains active.
        }
      }
      shouldContinue = false;
    } finally {
      inFlight = false;
      if (!disposed) {
        events.onBusy(false);
        if (revalidateQueued) {
          revalidateQueued = false;
          chunkTimer = setTimeout(() => void revalidate(), 0);
        } else if (shouldContinue && active(current)) {
          chunkTimer = setTimeout(() => void continueChunk(), nextDelay);
        }
      }
    }
  }

  function revalidate() {
    if (disposed || !initialized) return;
    if (inFlight) {
      revalidateQueued = true;
      return;
    }
    void perform(readCurrent, false);
  }

  function continueChunk() {
    if (!active(current)) return;
    const previous = current;
    return perform(async () => {
      const result = await apiPost<ContinueResponse>(
        `/api/v1/background-runs/${previous.run_id}/continue`,
        { idempotencyKey: idempotencyKey(), expected_cursor: previous.progress.cursor },
      );
      if (disposed) return;
      publish(result.run);
      shouldContinue = result.next === "continue" && active(result.run);
      const progressed =
        result.run.progress.step_index !== previous.progress.step_index ||
        result.run.progress.cursor !== previous.progress.cursor ||
        result.run.progress.processed !== previous.progress.processed;
      nextDelay = progressed ? CHUNK_YIELD_MS : NO_PROGRESS_DELAY_MS;
    }, true);
  }

  return {
    initialize(initial: Run | null) {
      if (initialized || disposed) return;
      initialized = true;
      publish(initial);
      pollTimer = setInterval(revalidate, CURRENT_INTERVAL_MS);
      revalidate();
    },
    revalidate,
    start() {
      if (active(current) || current?.status === "paused" || current?.status === "failed") return;
      return perform(async () => {
        const result = await apiPost<{ run: Run }>("/api/v1/background-runs", {
          kind: "maintenance",
          idempotencyKey: idempotencyKey(),
        });
        if (disposed) return;
        publish(result.run);
        shouldContinue = active(result.run);
        nextDelay = CHUNK_YIELD_MS;
      }, true);
    },
    resume() {
      if (current?.status !== "paused" && current?.status !== "failed") return;
      const runId = current.run_id;
      return perform(async () => {
        const result = await apiPost<{ run: Run }>(`/api/v1/background-runs/${runId}/resume`, {
          idempotencyKey: idempotencyKey(),
        });
        if (disposed) return;
        publish(result.run);
        shouldContinue = active(result.run);
        nextDelay = CHUNK_YIELD_MS;
      }, true);
    },
    dispose() {
      disposed = true;
      clearChunkTimer();
      if (pollTimer !== undefined) clearInterval(pollTimer);
    },
  };
}

export function useBackgroundRun(initial: Run | null | undefined, callbacks: Callbacks) {
  const [run, setRun] = useState<Run | null>(initial ?? null);
  const [busy, setBusy] = useState(false);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const runnerRef = useRef<ReturnType<typeof createRunner> | null>(null);

  useEffect(() => {
    const runner = createRunner({
      onRun: setRun,
      onBusy: setBusy,
      onSucceeded: () => callbacksRef.current.onSucceeded(),
      onError: (error) => callbacksRef.current.onError(error),
    });
    runnerRef.current = runner;
    window.addEventListener("focus", runner.revalidate);
    window.addEventListener("online", runner.revalidate);
    return () => {
      runner.dispose();
      runnerRef.current = null;
      window.removeEventListener("focus", runner.revalidate);
      window.removeEventListener("online", runner.revalidate);
    };
  }, []);

  useEffect(() => {
    // Bootstrap is only an initial seed. Later Bootstrap fetches can contain a
    // snapshot older than a continue response and must not rewind the Run.
    if (initial !== undefined) runnerRef.current?.initialize(initial);
  }, [initial]);

  return {
    run,
    busy,
    start: () => void runnerRef.current?.start(),
    resume: () => void runnerRef.current?.resume(),
  };
}
