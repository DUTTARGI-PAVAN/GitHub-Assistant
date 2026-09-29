import React, { useState, useEffect, useRef } from 'react';
import { 
  ArrowRight, 
  Loader2, 
  Sparkles, 
  Layers, 
  Cpu, 
  CheckCircle, 
  AlertTriangle,
  FileCode2
} from 'lucide-react';
import { ingestRepository, checkRepoStatus } from '../services/api';
import type { RepoInfo } from '../types';

const GithubIcon: React.FC<{ size?: number; className?: string }> = ({ size = 20, className }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round" 
    className={className}
  >
    <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
    <path d="M9 18c-4.51 2-5-2-7-2" />
  </svg>
);

interface RepoIngestionProps {
  onRepoReady: (repo: RepoInfo) => void;
}

const PRESET_REPOS = [
  { name: 'expressjs/express', url: 'https://github.com/expressjs/express', desc: 'Fast, unopinionated web framework for Node.js' },
  { name: 'honojs/hono', url: 'https://github.com/honojs/hono', desc: 'Ultrafast web framework for the Edges' },
  { name: 'facebook/react', url: 'https://github.com/facebook/react', desc: 'The library for web and native user interfaces' },
];

export const RepoIngestion: React.FC<RepoIngestionProps> = ({ onRepoReady }) => {
  const [repoUrl, setRepoUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentRepo, setCurrentRepo] = useState<RepoInfo | null>(null);
  const [stageText, setStageText] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = (repoId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);

    pollingRef.current = setInterval(async () => {
      try {
        const repo = await checkRepoStatus(repoId);
        setCurrentRepo(repo);

        if (repo.status === 'READY') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setLoading(false);
          setStageText('Repository ready!');
          setTimeout(() => onRepoReady(repo), 800);
        } else if (repo.status === 'FAILED') {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setLoading(false);
          setError('Repository indexing failed. Please ensure the repository is public and accessible.');
        } else if (repo.status === 'INDEXING') {
          setStageText('Downloading tarball, chunking code, and computing Gemini vector embeddings...');
        } else if (repo.status === 'PENDING') {
          setStageText('Enqueued in BullMQ worker. Waiting for worker assignment...');
        }
      } catch (err: any) {
        console.error('Error polling repo status:', err);
      }
    }, 2500);
  };

  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);

    const trimmed = repoUrl.trim();
    if (!trimmed) {
      setError('Please enter a GitHub repository URL');
      return;
    }

    if (!/^https:\/\/github\.com\/[^\/]+\/[^\/]+/.test(trimmed)) {
      setError('Please enter a valid GitHub URL, e.g. https://github.com/facebook/react');
      return;
    }

    try {
      setLoading(true);
      setStageText('Registering repository with backend...');
      const res = await ingestRepository(trimmed);

      if (res.status === 'READY') {
        setStageText('Repository already indexed! Loading chat...');
        const repo = await checkRepoStatus(res.repoId);
        setTimeout(() => onRepoReady(repo), 600);
        return;
      }

      setCurrentRepo({
        id: res.repoId,
        owner: trimmed.split('/')[3],
        name: trimmed.split('/')[4],
        status: res.status as any,
      });

      setStageText('Repository queued for indexing. BullMQ worker starting...');
      startPolling(res.repoId);
    } catch (err: any) {
      setLoading(false);
      setError(err.message || 'Failed to start repository indexing');
    }
  };

  const handleSelectPreset = (url: string) => {
    setRepoUrl(url);
    setError(null);
  };

  return (
    <div className="ingestion-container animate-slide-up">
      <div className="hero-section">
        <div className="hero-pill">
          <Sparkles size={14} className="hero-sparkle" />
          <span>Retrieval-Augmented Generation for Codebases</span>
        </div>

        <h1 className="hero-heading">
          Chat with any <span className="hero-highlight">GitHub Repository</span>
        </h1>
        <p className="hero-subtext">
          Deep codebase intelligence powered by Gemini 2.5 Flash and Pinecone vector search.
          Extract code, find architectures, and inspect precise line citations in seconds.
        </p>
      </div>

      <div className="ingestion-card glass-panel glow-border">
        <form onSubmit={handleSubmit} className="ingestion-form">
          <div className="input-wrapper">
            <GithubIcon className="input-icon" size={20} />
            <input
              id="github-repo-url-input"
              type="text"
              className="repo-input"
              placeholder="https://github.com/owner/repository"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                if (error) setError(null);
              }}
              disabled={loading}
              autoFocus
            />
          </div>

          <button 
            id="index-repo-submit-btn"
            type="submit" 
            className="submit-btn" 
            disabled={loading || !repoUrl.trim()}
          >
            {loading ? (
              <>
                <Loader2 size={18} className="animate-spin" />
                <span>Indexing...</span>
              </>
            ) : (
              <>
                <span>Analyze Codebase</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="error-banner animate-slide-up">
            <AlertTriangle size={18} className="error-icon" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="indexing-status-card animate-slide-up">
            <div className="status-header">
              <div className="status-spinner-wrap">
                <Loader2 size={24} className="animate-spin status-spinner" />
              </div>
              <div className="status-info">
                <h4>Indexing in Progress</h4>
                <p className="status-stage">{stageText}</p>
              </div>
              <span className="indexing-pill">
                {currentRepo?.status || 'PROCESSING'}
              </span>
            </div>

            <div className="progress-bar-track">
              <div className="progress-bar-fill animated-shimmer" />
            </div>

            <div className="pipeline-steps">
              <div className="pipeline-step active">
                <GithubIcon size={14} />
                <span>Fetch Tarball</span>
              </div>
              <div className="pipeline-arrow">→</div>
              <div className={`pipeline-step ${stageText.includes('chunking') || currentRepo?.status === 'READY' ? 'active' : ''}`}>
                <FileCode2 size={14} />
                <span>Chunk Lines</span>
              </div>
              <div className="pipeline-arrow">→</div>
              <div className={`pipeline-step ${stageText.includes('Pinecone') || currentRepo?.status === 'READY' ? 'active' : ''}`}>
                <Cpu size={14} />
                <span>Gemini Vectors</span>
              </div>
              <div className="pipeline-arrow">→</div>
              <div className={`pipeline-step ${currentRepo?.status === 'READY' ? 'active' : ''}`}>
                <CheckCircle size={14} />
                <span>Ready</span>
              </div>
            </div>
          </div>
        )}

        <div className="preset-section">
          <div className="preset-label">
            <Layers size={14} />
            <span>Or try popular repositories:</span>
          </div>
          <div className="preset-list">
            {PRESET_REPOS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="preset-chip"
                onClick={() => handleSelectPreset(preset.url)}
                disabled={loading}
              >
                <span className="preset-name">{preset.name}</span>
                <span className="preset-desc">{preset.desc}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="features-grid">
        <div className="feature-card glass-panel">
          <div className="feature-icon-box">
            <Cpu size={20} />
          </div>
          <h3>Gemini 2.5 Flash RAG</h3>
          <p>Context-aware answers generated specifically from retrieved code segments with high factual grounding.</p>
        </div>

        <div className="feature-card glass-panel">
          <div className="feature-icon-box">
            <FileCode2 size={20} />
          </div>
          <h3>Exact File & Line Citations</h3>
          <p>Every explanation is backed by exact file paths and line ranges. Click any citation to inspect code snippets.</p>
        </div>

        <div className="feature-card glass-panel">
          <div className="feature-icon-box">
            <Layers size={20} />
          </div>
          <h3>BullMQ Background Worker</h3>
          <p>Asynchronous queue architecture indexing repositories efficiently without locking your user session.</p>
        </div>
      </div>
    </div>
  );
};
