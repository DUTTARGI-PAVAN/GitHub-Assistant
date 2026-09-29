import React from 'react';
import { GitBranch, Sparkles, Database, CheckCircle2, Clock, AlertCircle } from 'lucide-react';
import type { RepoInfo } from '../types';

interface NavbarProps {
  activeRepo: RepoInfo | null;
  onResetRepo: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeRepo, onResetRepo }) => {
  return (
    <header className="navbar-container">
      <div className="navbar-brand" onClick={onResetRepo} style={{ cursor: 'pointer' }}>
        <div className="brand-icon">
          <Sparkles size={20} className="sparkle-svg" />
        </div>
        <div className="brand-text">
          <span className="brand-title">GitMind <span className="brand-gradient">AI</span></span>
          <span className="brand-subtitle">RAG Codebase Intelligence</span>
        </div>
      </div>

      <div className="navbar-actions">
        {activeRepo && (
          <div className="active-repo-badge">
            <GitBranch size={15} className="repo-icon" />
            <span className="repo-name">{activeRepo.owner}/{activeRepo.name}</span>
            <span className={`status-pill ${activeRepo.status.toLowerCase()}`}>
              {activeRepo.status === 'READY' && <CheckCircle2 size={13} />}
              {activeRepo.status === 'INDEXING' && <Clock size={13} className="animate-spin" />}
              {activeRepo.status === 'FAILED' && <AlertCircle size={13} />}
              {activeRepo.status}
            </span>
            <button 
              id="switch-repo-btn"
              className="switch-repo-btn" 
              onClick={onResetRepo}
              title="Switch to another repository"
            >
              Switch Repo
            </button>
          </div>
        )}

        <div className="tech-badge">
          <Database size={13} />
          <span>Gemini & Pinecone</span>
        </div>
      </div>
    </header>
  );
};
