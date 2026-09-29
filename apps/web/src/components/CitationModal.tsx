import React, { useEffect } from 'react';
import { X, FileCode, Copy, Check, ExternalLink } from 'lucide-react';
import type { SourceCitation, RepoInfo } from '../types';

interface CitationModalProps {
  citation: SourceCitation | null;
  repo: RepoInfo | null;
  onClose: () => void;
}

export const CitationModal: React.FC<CitationModalProps> = ({ citation, repo, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!citation) return null;

  const handleCopy = () => {
    if (citation.text) {
      navigator.clipboard.writeText(citation.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const githubFileUrl = repo
    ? `https://github.com/${repo.owner}/${repo.name}/blob/${repo.defaultBranch || 'main'}/${citation.filePath}#L${citation.startLine}-L${citation.endLine}`
    : null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div 
        className="modal-content glass-panel" 
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-header">
          <div className="modal-title-row">
            <FileCode size={18} className="citation-icon" />
            <span className="modal-file-path">{citation.filePath}</span>
            <span className="modal-lines-badge">
              L{citation.startLine} - L{citation.endLine}
            </span>
          </div>

          <div className="modal-actions">
            {githubFileUrl && (
              <a
                href={githubFileUrl}
                target="_blank"
                rel="noreferrer"
                className="modal-action-btn"
                title="Open on GitHub"
              >
                <ExternalLink size={15} />
                <span>GitHub</span>
              </a>
            )}
            <button 
              id="copy-citation-code-btn"
              className="modal-action-btn" 
              onClick={handleCopy}
              title="Copy code chunk"
            >
              {copied ? <Check size={15} color="#10b981" /> : <Copy size={15} />}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            <button 
              id="close-citation-modal-btn"
              className="modal-close-btn" 
              onClick={onClose}
              title="Close (Esc)"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="modal-body">
          {citation.score !== undefined && (
            <div className="citation-meta">
              <span>Vector Relevance Score: <strong>{(citation.score * 100).toFixed(1)}%</strong></span>
            </div>
          )}

          <div className="code-viewer-container">
            <pre className="code-viewer">
              <code>{citation.text || '// Full snippet context preview'}</code>
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
