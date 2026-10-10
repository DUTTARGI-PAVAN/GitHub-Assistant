import React, { useState, useRef, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Send, 
  Sparkles, 
  User, 
  FileCode, 
  Copy, 
  Check, 
  Square, 
  ExternalLink,
  MessageSquare,
  HelpCircle,
  Code2,
  Layers,
  ChevronRight,
  Plus,
  Trash2,
  History,
  Loader2,
  FolderTree,
  Search,
  FileText
} from 'lucide-react';
import type { RepoInfo, ChatMessage, SourceCitation, ChatSessionSummary, RepoFile } from '../types';
import { streamChatMessage, getRepoSessions, getSessionMessages, deleteSession, getRepoFiles } from '../services/api';

interface ChatViewProps {
  repo: RepoInfo;
  onOpenCitation: (citation: SourceCitation) => void;
}

const SUGGESTED_QUESTIONS = [
  'How is the repository structured and what are the main modules?',
  'Explain the request and response flow through this codebase.',
  'Where are error handling and validation implemented?',
  'What external libraries or database connections does this project use?',
];

export const ChatView: React.FC<ChatViewProps> = ({ repo, onOpenCitation }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>();
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // Files tab state
  const [activeSidebarTab, setActiveSidebarTab] = useState<'chat' | 'files'>('chat');
  const [repoFiles, setRepoFiles] = useState<RepoFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState('');

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  // Adjust textarea height automatically
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  // Load list of sessions for this repo
  const loadSessions = useCallback(async () => {
    try {
      setLoadingSessions(true);
      const data = await getRepoSessions(repo.id);
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    } finally {
      setLoadingSessions(false);
    }
  }, [repo.id]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Load indexed files for this repo
  const loadFiles = useCallback(async () => {
    try {
      setLoadingFiles(true);
      const res = await getRepoFiles(repo.id);
      setRepoFiles(res.files);
    } catch (err) {
      console.error('Failed to load repository files:', err);
    } finally {
      setLoadingFiles(false);
    }
  }, [repo.id]);

  useEffect(() => {
    if (activeSidebarTab === 'files' && repoFiles.length === 0) {
      loadFiles();
    }
  }, [activeSidebarTab, loadFiles, repoFiles.length]);

  // Switch to a past session and load its message history
  const handleSelectSession = async (sessionId: string) => {
    if (sessionId === activeSessionId || isGenerating) return;

    try {
      setLoadingMessages(true);
      setActiveSessionId(sessionId);
      const pastMessages = await getSessionMessages(sessionId);
      setMessages(pastMessages);
    } catch (err) {
      console.error('Failed to load session messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  };

  // Start a fresh new chat conversation
  const handleNewChat = () => {
    if (isGenerating) return;
    setActiveSessionId(undefined);
    setMessages([]);
  };

  // Delete a session
  const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      if (activeSessionId === sessionId) {
        handleNewChat();
      }
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend || input).trim();
    if (!query || isGenerating) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    const assistantMsgId = crypto.randomUUID();
    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      sources: [],
      isStreaming: true,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder]);
    setInput('');
    setIsGenerating(true);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      await streamChatMessage({
        repoId: repo.id,
        sessionId: activeSessionId,
        message: query,
        signal: abortController.signal,
        onCitations: (sources, newSessionId) => {
          if (newSessionId && !activeSessionId) {
            setActiveSessionId(newSessionId);
          }
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, sources } : msg
            )
          );
        },
        onToken: (token) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? { ...msg, content: msg.content + token }
                : msg
            )
          );
        },
        onDone: () => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId ? { ...msg, isStreaming: false } : msg
            )
          );
          setIsGenerating(false);
          // Refresh sessions list to show newly created session or updated title
          loadSessions();
        },
        onError: (err) => {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === assistantMsgId
                ? {
                    ...msg,
                    content: msg.content || `⚠️ Error: ${err.message}`,
                    isStreaming: false,
                  }
                : msg
            )
          );
          setIsGenerating(false);
        },
      });
    } catch (err: any) {
      console.error('Chat error:', err);
      setIsGenerating(false);
    }
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      setIsGenerating(false);
      setMessages((prev) =>
        prev.map((msg) => (msg.isStreaming ? { ...msg, isStreaming: false } : msg))
      );
    }
  };

  const handleCopyCode = (codeText: string, id: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCodeId(id);
    setTimeout(() => setCopiedCodeId(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const filteredFiles = repoFiles.filter((f) =>
    f.path.toLowerCase().includes(fileSearchQuery.toLowerCase())
  );

  return (
    <div className="chat-layout animate-slide-up">
      {/* Sidebar with repository metadata, past sessions, and files explorer */}
      <aside className="chat-sidebar glass-panel">
        <div className="sidebar-repo-card">
          <div className="repo-card-top">
            <span className="repo-avatar">{repo.name.charAt(0).toUpperCase()}</span>
            <div className="repo-titles">
              <h3 className="repo-card-name" title={repo.name}>{repo.name}</h3>
              <span className="repo-card-owner">{repo.owner}</span>
            </div>
          </div>

          <div className="repo-meta-row">
            <span className="meta-tag branch-tag">
              Branch: {repo.defaultBranch || 'main'}
            </span>
            <button 
              type="button" 
              className="meta-tag file-count-tag"
              onClick={() => {
                setActiveSidebarTab('files');
                if (repoFiles.length === 0) loadFiles();
              }}
              title="Browse indexed files"
            >
              <FileCode size={11} />
              <span>{repo.fileCount ? `${repo.fileCount} files` : 'Files'}</span>
            </button>
          </div>

          <a
            href={`https://github.com/${repo.owner}/${repo.name}`}
            target="_blank"
            rel="noreferrer"
            className="sidebar-gh-link"
          >
            <span>View on GitHub</span>
            <ExternalLink size={13} />
          </a>
        </div>

        {/* Sidebar Navigation Tabs */}
        <div className="sidebar-tabs-nav">
          <button
            type="button"
            className={`sidebar-tab-btn ${activeSidebarTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveSidebarTab('chat')}
          >
            <MessageSquare size={14} />
            <span>Chat</span>
          </button>
          <button
            type="button"
            className={`sidebar-tab-btn ${activeSidebarTab === 'files' ? 'active' : ''}`}
            onClick={() => {
              setActiveSidebarTab('files');
              if (repoFiles.length === 0) loadFiles();
            }}
          >
            <FolderTree size={14} />
            <span>Files {repoFiles.length > 0 && `(${repoFiles.length})`}</span>
          </button>
        </div>

        {/* TAB 1: Chat Sessions & Suggestions */}
        {activeSidebarTab === 'chat' && (
          <>
            <button
              id="new-chat-btn"
              type="button"
              className="new-chat-action-btn"
              onClick={handleNewChat}
              disabled={isGenerating}
            >
              <Plus size={16} />
              <span>New Conversation</span>
            </button>

            <div className="sidebar-section sessions-history-section">
              <div className="sidebar-section-title">
                <History size={14} />
                <span>Chat History {sessions.length > 0 && `(${sessions.length})`}</span>
              </div>

              <div className="sessions-list-scroll">
                {loadingSessions ? (
                  <div className="sidebar-loading-state">
                    <Loader2 size={16} className="animate-spin" />
                    <span>Loading sessions...</span>
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="no-sessions-hint">
                    <span>No past sessions yet. Ask a question to start!</span>
                  </div>
                ) : (
                  sessions.map((s) => (
                    <div
                      key={s.id}
                      className={`session-item-row ${s.id === activeSessionId ? 'active' : ''}`}
                      onClick={() => handleSelectSession(s.id)}
                    >
                      <MessageSquare size={14} className="session-icon" />
                      <div className="session-details">
                        <span className="session-title" title={s.title}>{s.title}</span>
                        <span className="session-count">{s.messageCount} messages</span>
                      </div>
                      <button
                        type="button"
                        className="delete-session-btn"
                        onClick={(e) => handleDeleteSession(e, s.id)}
                        title="Delete session"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="sidebar-section">
              <div className="sidebar-section-title">
                <HelpCircle size={14} />
                <span>Suggested Questions</span>
              </div>
              <div className="suggested-questions-list">
                {SUGGESTED_QUESTIONS.map((q, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="suggested-q-btn"
                    onClick={() => handleSendMessage(q)}
                    disabled={isGenerating}
                  >
                    <span>{q}</span>
                    <ChevronRight size={13} className="suggested-arrow" />
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        {/* TAB 2: Indexed Files Explorer */}
        {activeSidebarTab === 'files' && (
          <div className="sidebar-section files-explorer-section">
            <div className="sidebar-section-title">
              <FileCode size={14} />
              <span>Indexed Source Files ({repoFiles.length})</span>
            </div>

            <div className="file-search-wrapper">
              <Search size={14} className="file-search-icon" />
              <input
                type="text"
                className="file-search-input"
                placeholder="Search files..."
                value={fileSearchQuery}
                onChange={(e) => setFileSearchQuery(e.target.value)}
              />
            </div>

            <div className="files-list-scroll">
              {loadingFiles ? (
                <div className="sidebar-loading-state">
                  <Loader2 size={16} className="animate-spin" />
                  <span>Loading indexed files...</span>
                </div>
              ) : filteredFiles.length === 0 ? (
                <div className="no-sessions-hint">
                  <span>{fileSearchQuery ? 'No matching files found.' : 'No files indexed.'}</span>
                </div>
              ) : (
                filteredFiles.map((f) => (
                  <div
                    key={f.id}
                    className="file-item-row"
                    onClick={() => {
                      setActiveSidebarTab('chat');
                      handleSendMessage(`Explain the purpose, structure, and functions of ${f.path}`);
                    }}
                    title={`Click to ask about ${f.path}`}
                  >
                    <FileText size={14} className="file-item-icon" />
                    <div className="file-item-details">
                      <span className="file-item-path" title={f.path}>{f.path}</span>
                      <span className="file-item-chunks">{f.chunkCount} {f.chunkCount === 1 ? 'chunk' : 'chunks'}</span>
                    </div>
                    {f.language && (
                      <span className="file-lang-pill">{f.language}</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </aside>

      {/* Main Conversation Panel */}
      <main className="chat-main glass-panel">
        <div className="chat-messages-scroll">
          {loadingMessages ? (
            <div className="empty-chat-state animate-slide-up">
              <Loader2 size={36} className="animate-spin" style={{ color: 'var(--accent-primary)' }} />
              <p>Restoring conversation history...</p>
            </div>
          ) : messages.length === 0 ? (
            <div className="empty-chat-state animate-slide-up">
              <div className="empty-chat-icon-box animate-pulse-glow">
                <Sparkles size={32} />
              </div>
              <h2>Ask anything about <span className="highlight-text">{repo.owner}/{repo.name}</span></h2>
              <p>
                The RAG pipeline retrieves relevant code vectors from Pinecone and synthesizes answers using Gemini with exact file and line citations.
              </p>

              <div className="starter-grid">
                {SUGGESTED_QUESTIONS.map((q, i) => (
                  <div 
                    key={i} 
                    className="starter-card glass-panel"
                    onClick={() => handleSendMessage(q)}
                  >
                    <Code2 size={16} className="starter-icon" />
                    <span>{q}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((msg) => (
                <div key={msg.id} className={`message-row ${msg.role}`}>
                  <div className={`message-avatar ${msg.role}`}>
                    {msg.role === 'user' ? <User size={16} /> : <Sparkles size={16} />}
                  </div>

                  <div className="message-content-wrapper">
                    <div className="message-header-row">
                      <span className="sender-name">
                        {msg.role === 'user' ? 'You' : 'GitMind Assistant'}
                      </span>
                      {msg.createdAt && (
                        <span className="message-time">{msg.createdAt}</span>
                      )}
                    </div>

                    <div className="message-bubble">
                      {msg.role === 'assistant' ? (
                        <div className="markdown-body">
                          {msg.content ? (
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={{
                                code({ className, children, ...props }) {
                                  const match = /language-(\w+)/.exec(className || '');
                                  const codeContent = String(children).replace(/\n$/, '');
                                  const isInline = !match && !codeContent.includes('\n');

                                  if (isInline) {
                                    return <code className="inline-code" {...props}>{children}</code>;
                                  }

                                  const blockId = Math.random().toString(36).substring(7);
                                  const isCopied = copiedCodeId === blockId;

                                  return (
                                    <div className="code-block-wrapper">
                                      <div className="code-block-header">
                                        <span className="code-lang-label">
                                          {match ? match[1] : 'code'}
                                        </span>
                                        <button
                                          type="button"
                                          className="copy-code-btn"
                                          onClick={() => handleCopyCode(codeContent, blockId)}
                                          title="Copy code"
                                        >
                                          {isCopied ? <Check size={13} color="#10b981" /> : <Copy size={13} />}
                                          <span>{isCopied ? 'Copied' : 'Copy'}</span>
                                        </button>
                                      </div>
                                      <pre className="code-block-pre">
                                        <code className={className} {...props}>
                                          {children}
                                        </code>
                                      </pre>
                                    </div>
                                  );
                                },
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          ) : (
                            <div className="generating-loader">
                              <span className="thinking-dot" />
                              <span className="thinking-dot" />
                              <span className="thinking-dot" />
                              <span className="generating-text">Analyzing codebase & retrieving chunks...</span>
                            </div>
                          )}

                          {msg.isStreaming && msg.content && (
                            <span className="cursor-blink" />
                          )}
                        </div>
                      ) : (
                        <p className="user-message-text">{msg.content}</p>
                      )}
                    </div>

                    {/* Citations / Referenced Sources */}
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="sources-container">
                        <div className="sources-label">
                          <Layers size={13} />
                          <span>Referenced Sources ({msg.sources.length}):</span>
                        </div>
                        <div className="citations-pills-list">
                          {msg.sources.map((src, sIdx) => (
                            <button
                              key={sIdx}
                              type="button"
                              className="citation-pill"
                              onClick={() => onOpenCitation(src)}
                              title={`Inspect ${src.filePath} (Lines ${src.startLine}-${src.endLine})`}
                            >
                              <FileCode size={13} className="citation-pill-icon" />
                              <span className="citation-pill-file">{src.filePath}</span>
                              <span className="citation-pill-lines">
                                L{src.startLine}–{src.endLine}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="chat-input-bar">
          <div className="input-bar-inner">
            <textarea
              id="chat-message-textarea"
              ref={textareaRef}
              className="chat-textarea"
              placeholder={`Ask a question about ${repo.name}... (Enter to send, Shift+Enter for newline)`}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isGenerating}
            />

            <div className="input-actions">
              {isGenerating ? (
                <button
                  id="stop-generation-btn"
                  type="button"
                  className="stop-btn"
                  onClick={handleStopGeneration}
                  title="Stop generation"
                >
                  <Square size={16} fill="currentColor" />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  id="send-message-btn"
                  type="button"
                  className="send-btn"
                  onClick={() => handleSendMessage()}
                  disabled={!input.trim()}
                  title="Send message"
                >
                  <Send size={16} />
                </button>
              )}
            </div>
          </div>
          <div className="input-hint">
            <span>Powered by Gemini 3.8 Flash • Multi-turn conversational memory & Pinecone grounding</span>
          </div>
        </div>
      </main>
    </div>
  );
};
