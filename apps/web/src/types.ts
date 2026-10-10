export type RepoStatus = 'PENDING' | 'INDEXING' | 'READY' | 'FAILED';

export interface RepoInfo {
  id: string;
  githubUrl?: string;
  owner: string;
  name: string;
  defaultBranch?: string;
  status: RepoStatus;
  fileCount?: number;
}

export interface SourceCitation {
  filePath: string;
  startLine: number;
  endLine: number;
  text?: string;
  score?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: SourceCitation[];
  createdAt?: string;
  isStreaming?: boolean;
}

export interface ChatSessionSummary {
  id: string;
  repoId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  messageCount: number;
}

export interface RepoFile {
  id: string;
  path: string;
  language: string | null;
  chunkCount: number;
}

