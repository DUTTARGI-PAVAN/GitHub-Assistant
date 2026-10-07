import type { RepoInfo, SourceCitation, ChatMessage, ChatSessionSummary } from '../types';

const API_BASE = ''; // Uses Vite proxy to /api

export async function ingestRepository(githubUrl: string): Promise<{ repoId: string; status: string; message: string }> {
  const res = await fetch(`${API_BASE}/api/repos/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ githubUrl }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to ingest repository');
  }

  return data;
}

export async function checkRepoStatus(repoId: string): Promise<RepoInfo> {
  const res = await fetch(`${API_BASE}/api/repos/${repoId}/status`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to check repository status');
  }
  return data;
}

export async function getRepoSessions(repoId: string): Promise<ChatSessionSummary[]> {
  const res = await fetch(`${API_BASE}/api/chat/sessions/${repoId}`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch sessions');
  }
  return data;
}

export async function getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
  const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}/messages`);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Failed to fetch session messages');
  }
  return data;
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Failed to delete session');
  }
}

export interface StreamChatParams {
  repoId: string;
  sessionId?: string;
  message: string;
  signal?: AbortSignal;
  onCitations?: (sources: SourceCitation[], sessionId: string) => void;
  onToken?: (token: string) => void;
  onDone?: () => void;
  onError?: (err: Error) => void;
}

export async function streamChatMessage({
  repoId,
  sessionId,
  message,
  signal,
  onCitations,
  onToken,
  onDone,
  onError,
}: StreamChatParams): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId, sessionId, message }),
      signal,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP error ${res.status}`);
    }

    if (!res.body) {
      throw new Error('ReadableStream not supported by browser or empty response');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      for (const block of parts) {
        if (!block.trim()) continue;

        let eventType = 'message';
        let dataStr = '';

        for (const line of block.split('\n')) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            dataStr = line.slice(6).trim();
          }
        }

        if (eventType === 'citations') {
          try {
            const parsed = JSON.parse(dataStr);
            if (onCitations) {
              onCitations(parsed.sources || [], parsed.sessionId || '');
            }
          } catch (e) {
            console.error('Failed to parse citations payload', e);
          }
        } else if (eventType === 'token') {
          try {
            const parsed = JSON.parse(dataStr);
            if (onToken && parsed.token) {
              onToken(parsed.token);
            }
          } catch (e) {
            console.error('Failed to parse token payload', e);
          }
        } else if (eventType === 'error') {
          try {
            const parsed = JSON.parse(dataStr);
            throw new Error(parsed.error || 'Server stream error');
          } catch (e: any) {
            if (onError) onError(e);
            return;
          }
        } else if (eventType === 'done' || dataStr === '[DONE]') {
          if (onDone) onDone();
          return;
        }
      }
    }

    if (onDone) onDone();
  } catch (err: any) {
    if (signal?.aborted) return;
    if (onError) onError(err);
    else console.error('Chat stream failed:', err);
  }
}
