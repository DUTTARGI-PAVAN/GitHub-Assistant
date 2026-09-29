import React, { useState, useEffect } from 'react';
import './App.css';
import { Navbar } from './components/Navbar';
import { RepoIngestion } from './components/RepoIngestion';
import { ChatView } from './components/ChatView';
import { CitationModal } from './components/CitationModal';
import type { RepoInfo, SourceCitation } from './types';

export const App: React.FC = () => {
  const [activeRepo, setActiveRepo] = useState<RepoInfo | null>(() => {
    try {
      const saved = localStorage.getItem('gitmind_active_repo');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  const [activeCitation, setActiveCitation] = useState<SourceCitation | null>(null);

  useEffect(() => {
    if (activeRepo) {
      localStorage.setItem('gitmind_active_repo', JSON.stringify(activeRepo));
    } else {
      localStorage.removeItem('gitmind_active_repo');
    }
  }, [activeRepo]);

  const handleResetRepo = () => {
    setActiveRepo(null);
  };

  return (
    <div className="app-container">
      <Navbar activeRepo={activeRepo} onResetRepo={handleResetRepo} />

      <div className="app-content">
        {!activeRepo || activeRepo.status !== 'READY' ? (
          <RepoIngestion onRepoReady={(repo) => setActiveRepo(repo)} />
        ) : (
          <ChatView 
            repo={activeRepo} 
            onOpenCitation={(citation) => setActiveCitation(citation)} 
          />
        )}
      </div>

      <CitationModal
        citation={activeCitation}
        repo={activeRepo}
        onClose={() => setActiveCitation(null)}
      />
    </div>
  );
};

export default App;
