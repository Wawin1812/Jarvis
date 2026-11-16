import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuditEvent, ServerStatus } from './types';

type Api = (path: string, init?: RequestInit) => Promise<Response>;

/** Polls the backend for status, remembered notes and the audit trail that feeds the activity timeline. */
export function useJarvisData(api: Api, token: string, apiBase: string) {
  const apiRef = useRef(api);
  apiRef.current = api;
  const [server, setServer] = useState<ServerStatus | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);

  const refresh = useCallback(async (full: boolean) => {
    try {
      const [audit, info, memory] = await Promise.all([
        apiRef.current('/audit?limit=40'),
        full ? apiRef.current('/status') : null,
        full ? apiRef.current('/memory') : null,
      ]);
      if (audit.ok) setEvents((await audit.json()).events ?? []);
      if (info?.ok) setServer(await info.json());
      if (memory?.ok) setNotes((await memory.json()).notes ?? []);
    } catch {
      // The next poll retries; connection problems are shown by the health check.
    }
  }, []);

  useEffect(() => {
    if (!token.trim()) {
      setServer(null);
      setNotes([]);
      setEvents([]);
      return undefined;
    }
    let tick = 0;
    void refresh(true);
    const timer = setInterval(() => { tick += 1; void refresh(tick % 4 === 0); }, 2_500);
    return () => clearInterval(timer);
  }, [token, apiBase, refresh]);

  async function forget(note: string) {
    const response = await apiRef.current('/memory/forget', { method: 'POST', body: JSON.stringify({ note }) });
    if (response.ok) setNotes((await response.json()).notes ?? []);
  }

  async function revokeTrust() {
    await apiRef.current('/trust', { method: 'DELETE' });
    await refresh(true);
  }

  /** Returns a one-line result for display. */
  async function reindex(): Promise<string> {
    try {
      const response = await apiRef.current('/knowledge/index', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) return data.error ?? `Indexing failed (HTTP ${response.status}).`;
      await refresh(true);
      return `Indexed ${data.indexed} new or changed file(s); ${data.files} files, ${data.chunks} chunks total.`;
    } catch (error) {
      return error instanceof Error ? error.message : 'Indexing failed.';
    }
  }

  return { server, notes, events, forget, revokeTrust, reindex };
}
