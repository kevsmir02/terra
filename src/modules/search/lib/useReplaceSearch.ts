import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  previewReplace,
  type ReplacePreview,
  type ReplaceQuery,
  SUPERSEDED,
} from "./replace";

const DEBOUNCE_MS = 250;

export type SearchStatus =
  | { kind: "idle" }
  | { kind: "searching" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

function cancelInFlight() {
  void invoke("fs_replace_cancel").catch(() => {});
}

/**
 * Debounced preview for the replace view. A newer query supersedes the walk
 * server-side, and unmounting or clearing the query cancels it, so a closed
 * view leaves nothing running.
 */
export function useReplaceSearch(root: string | null, query: ReplaceQuery) {
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [status, setStatus] = useState<SearchStatus>({ kind: "idle" });
  // The query the shown preview answers. Until the debounce catches up, a
  // typed change leaves the preview stale, and a stale one must not apply.
  const [answered, setAnswered] = useState<string | null>(null);
  const requestRef = useRef(0);
  const inFlightRef = useRef(false);
  const queryRef = useRef(query);
  queryRef.current = query;
  const key = JSON.stringify([root, query]);

  const run = useCallback(async () => {
    const id = ++requestRef.current;
    const q = queryRef.current;
    const asked = JSON.stringify([root, q]);
    if (!root || q.pattern === "") {
      if (inFlightRef.current) cancelInFlight();
      inFlightRef.current = false;
      setPreview(null);
      setStatus({ kind: "idle" });
      return;
    }
    setStatus({ kind: "searching" });
    inFlightRef.current = true;
    try {
      const next = await previewReplace(root, q);
      if (id !== requestRef.current) return;
      setPreview(next);
      setAnswered(asked);
      setStatus({ kind: "ready" });
    } catch (e) {
      const message = String(e);
      if (id !== requestRef.current || message === SUPERSEDED) return;
      setPreview(null);
      setStatus({ kind: "error", message });
    } finally {
      if (id === requestRef.current) inFlightRef.current = false;
    }
  }, [root]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the query's value identity; `run` reads the latest query from a ref.
  useEffect(() => {
    const handle = window.setTimeout(() => void run(), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [key, run]);

  useEffect(() => {
    return () => {
      requestRef.current++;
      if (inFlightRef.current) cancelInFlight();
    };
  }, []);

  return { preview, status, current: answered === key, refresh: run };
}
