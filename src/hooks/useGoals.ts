import { useCallback, useEffect, useRef, useState } from "react";
import { fetchGoals } from "../api/github";
import type { RepositoryGoal } from "../types/goals";

interface UseGoalsOptions {
  accountId: string | null;
  enabled: boolean;
  repository: string;
}

export interface GoalsState {
  goals: RepositoryGoal[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

/** Loads the goals for one repository and cancels stale account or route requests. */
export function useGoals({ accountId, enabled, repository }: UseGoalsOptions): GoalsState {
  const [goals, setGoals] = useState<RepositoryGoal[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState("");
  const [loadedKey, setLoadedKey] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const requestKey = JSON.stringify([accountId, repository]);

  const refresh = useCallback(async () => {
    if (!enabled || !repository) return;

    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");

    try {
      const result = await fetchGoals(controller.signal);
      if (!controller.signal.aborted && requestRef.current === controller) {
        setGoals(result.goals.filter((goal) => goal.repository === repository));
      }
    } catch (cause) {
      if (!controller.signal.aborted && (cause as Error).name !== "AbortError" && requestRef.current === controller) {
        setError((cause as Error).message);
      }
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoadedKey(requestKey);
        setLoading(false);
      }
    }
  }, [enabled, repository, requestKey]);

  useEffect(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setGoals([]);
    setError("");
    if (!enabled || !repository) {
      setLoading(false);
      return;
    }

    void refresh();
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, [enabled, repository, refresh]);

  return {
    goals,
    loading: loading || Boolean(enabled && repository && loadedKey !== requestKey),
    error,
    refresh,
  };
}
