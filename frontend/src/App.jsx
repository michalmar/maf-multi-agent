import React, { useState, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Plane, AlertTriangle, Sun, Moon, Radio, FileText, Sparkles } from 'lucide-react';
import AgentFlowGraph from './components/AgentFlowGraph';
import QueryInput from './components/QueryInputNew';
import EventStream from './components/EventStreamNew';
import TaskPanel from './components/TaskPanelNew';
import OutputPanel from './components/OutputPanel';

const STATUS = { IDLE: 'idle', RUNNING: 'running', DONE: 'done', ERROR: 'error' };

const STATUS_CONFIG = {
  [STATUS.IDLE]:    { label: 'Ready',          color: 'var(--text-muted)',     bg: 'var(--bg-surface)' },
  [STATUS.RUNNING]: { label: '● Processing…',  color: 'var(--color-active)',   bg: 'color-mix(in srgb, var(--color-active) 12%, transparent)' },
  [STATUS.DONE]:    { label: '✓ Complete',      color: 'var(--color-success)',  bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)' },
  [STATUS.ERROR]:   { label: '✕ Error',         color: 'var(--color-error)',    bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)' },
};

function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);
  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  return { theme, toggle };
}

export default function App() {
  const [status, setStatus] = useState(STATUS.IDLE);
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [agents, setAgents] = useState([]);
  const [activeAgent, setActiveAgent] = useState(null);
  const [highlightedTask, setHighlightedTask] = useState(null);
  const [mainTab, setMainTab] = useState('activity');
  const { theme, toggle: toggleTheme } = useTheme();

  // Fetch available agents on mount
  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => {});
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'Escape') {
        setActiveAgent(null);
        setHighlightedTask(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-switch to result tab when done
  useEffect(() => {
    if (result && status === STATUS.DONE) setMainTab('result');
  }, [result, status]);

  const handleRun = useCallback(async (query) => {
    setStatus(STATUS.RUNNING);
    setEvents([]);
    setTasks([]);
    setDocuments([]);
    setResult('');
    setError('');
    setActiveAgent(null);
    setHighlightedTask(null);
    setMainTab('activity');

    try {
      const res = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { run_id } = await res.json();

      const evtSource = new EventSource(`/api/stream/${run_id}`);
      evtSource.onmessage = (msg) => {
        const evt = JSON.parse(msg.data);

        if (evt.event_type === 'done') {
          evtSource.close();
          setStatus(STATUS.DONE);
          return;
        }

        setEvents((prev) => [...prev, evt]);

        if (evt.event_type === 'tasks_created' || evt.event_type === 'task_completed') {
          setTasks(evt.data.tasks || []);
        }

        if (evt.event_type === 'document_updated') {
          setDocuments((prev) => [
            ...prev,
            { version: evt.data.version, content: evt.data.content, action: evt.data.history?.action || 'update' },
          ]);
        }

        if (evt.event_type === 'output' && evt.source === 'orchestrator') {
          setResult(evt.data.text || '');
          if (evt.data.document) {
            setDocuments((prev) => [
              ...prev,
              { version: 'final', content: evt.data.document, action: 'final' },
            ]);
          }
        }
      };

      evtSource.onerror = () => {
        evtSource.close();
        setStatus((prev) => {
          if (prev !== STATUS.DONE) {
            setError('Connection lost');
            return STATUS.ERROR;
          }
          return prev;
        });
      };
    } catch (e) {
      setError(e.message);
      setStatus(STATUS.ERROR);
    }
  }, []);

  const handleAgentClick = useCallback((agentKey) => {
    setActiveAgent((prev) => (prev === agentKey ? null : agentKey));
  }, []);

  const handleTaskClick = useCallback((taskId) => {
    setHighlightedTask((prev) => (prev === taskId ? null : taskId));
  }, []);

  const sc = STATUS_CONFIG[status];

  const mainTabs = [
    { id: 'activity', label: 'Activity',  icon: Radio,    badge: events.filter(e => !['agent_streaming','tool_decision','task_completed'].includes(e.event_type)).length },
    { id: 'document', label: 'Document',  icon: FileText,  badge: documents.length },
    { id: 'result',   label: 'Result',    icon: Sparkles,  badge: result ? 1 : 0 },
  ];

  return (
    <div className="min-h-screen noise-overlay relative" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      {/* ── Header ──────────────────────────────────── */}
      <header className="glass-strong sticky top-0 z-50">
        <div className="gradient-line" />
        <div className="max-w-[1600px] mx-auto px-6 py-3.5 flex items-center gap-3">
          <Plane size={20} style={{ color: 'var(--agent-orchestrator)' }} />
          <h1 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Multi-Agent Travel Planner
          </h1>
          <motion.span
            key={status}
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className={`ml-auto px-3 py-1 rounded-full text-xs font-medium ${status === STATUS.RUNNING ? 'animate-pulse' : ''}`}
            style={{ color: sc.color, background: sc.bg }}
          >
            {sc.label}
          </motion.span>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-2 rounded-lg transition-colors hover:bg-white/5"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark'
              ? <Sun size={16} style={{ color: 'var(--text-muted)' }} />
              : <Moon size={16} style={{ color: 'var(--text-muted)' }} />}
          </button>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto px-6 py-5 relative z-10 flex flex-col" style={{ minHeight: 'calc(100vh - 52px)' }}>
        {/* ── Top panel: Agent Flow (left) + Tasks (right) ── */}
        <div className="grid grid-cols-2 gap-5 mb-5" style={{ alignItems: 'stretch' }}>
          <div className="min-w-0">
            <AgentFlowGraph
              agents={agents}
              events={events}
              workflowStatus={status}
              activeAgent={activeAgent}
              onAgentClick={handleAgentClick}
            />
          </div>
          <div>
            {tasks.length > 0 ? (
              <TaskPanel
                tasks={tasks}
                onTaskClick={handleTaskClick}
                highlightedTask={highlightedTask}
              />
            ) : (
              <div className="glass rounded-2xl p-5 h-full flex items-center justify-center">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Tasks will appear here once planning starts
                </p>
              </div>
            )}
          </div>
        </div>

        {/* ── Query Input ──────────────────────────── */}
        <QueryInput onRun={handleRun} disabled={status === STATUS.RUNNING} />

        {/* ── Error banner ─────────────────────────── */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-5 p-3 rounded-xl flex items-center gap-2 text-sm"
              style={{
                background: 'color-mix(in srgb, var(--color-error) 10%, var(--bg-surface))',
                border: '1px solid color-mix(in srgb, var(--color-error) 25%, transparent)',
                color: '#F87171',
              }}
            >
              <AlertTriangle size={15} />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Tabbed main panel: Activity | Document | Result ── */}
        <AnimatePresence>
          {(events.length > 0 || status !== STATUS.IDLE) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="glass rounded-2xl p-5 flex-1 flex flex-col"
            >
              {/* Tab bar */}
              <div className="flex items-center gap-1 mb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                {mainTabs.map((t) => {
                  const Icon = t.icon;
                  const active = mainTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setMainTab(t.id)}
                      className="relative px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors"
                      style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
                    >
                      <Icon
                        size={13}
                        style={{ color: active
                          ? (t.id === 'result' ? 'var(--color-success)' : t.id === 'document' ? 'var(--color-info)' : 'var(--color-active)')
                          : 'var(--text-muted)'
                        }}
                      />
                      {t.label}
                      {t.badge > 0 && !active && (
                        <span
                          className="ml-1 min-w-4 h-4 px-1 rounded-full text-[10px] flex items-center justify-center font-bold"
                          style={{
                            background: t.id === 'result' ? 'var(--color-success)' : t.id === 'document' ? 'var(--color-info)' : 'var(--color-active)',
                            color: 'white',
                          }}
                        >
                          {t.badge > 99 ? '99+' : t.badge}
                        </span>
                      )}
                      {active && (
                        <motion.div
                          layoutId="main-tab-underline"
                          className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                          style={{
                            background: t.id === 'result' ? 'var(--color-success)' : t.id === 'document' ? 'var(--color-info)' : 'var(--color-active)',
                          }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={mainTab}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="flex-1 flex flex-col min-h-0"
                >
                  {mainTab === 'activity' && (
                    <EventStream
                      events={events}
                      running={status === STATUS.RUNNING}
                      activeAgent={activeAgent}
                      highlightedTask={highlightedTask}
                      embedded
                    />
                  )}
                  {mainTab === 'document' && (
                    <OutputPanel documents={documents} result={null} status={status} tabOverride="document" />
                  )}
                  {mainTab === 'result' && (
                    <OutputPanel documents={[]} result={result} status={status} tabOverride="result" />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
