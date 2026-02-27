import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Sparkles, GitCompare, Copy, Check, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

function simpleDiff(oldText, newText) {
  if (!oldText) return newText.split('\n').map((line) => ({ type: 'add', text: line }));
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result = [];
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i >= oldLines.length) {
      result.push({ type: 'add', text: newLines[i] });
    } else if (i >= newLines.length) {
      result.push({ type: 'remove', text: oldLines[i] });
    } else if (oldLines[i] !== newLines[i]) {
      result.push({ type: 'remove', text: oldLines[i] });
      result.push({ type: 'add', text: newLines[i] });
    } else {
      result.push({ type: 'same', text: oldLines[i] });
    }
  }
  return result;
}

function DiffView({ oldContent, newContent }) {
  const lines = simpleDiff(oldContent || '', newContent || '');
  return (
    <div className="font-mono text-xs leading-relaxed">
      {lines.map((line, i) => (
        <div
          key={i}
          className="px-2 py-0.5"
          style={{
            background:
              line.type === 'add' ? 'rgba(16, 185, 129, 0.08)' :
              line.type === 'remove' ? 'rgba(239, 68, 68, 0.08)' : 'transparent',
            color:
              line.type === 'add' ? '#34D399' :
              line.type === 'remove' ? '#F87171' : 'var(--text-secondary)',
          }}
        >
          <span className="inline-block w-4 select-none opacity-50">
            {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
          </span>
          {line.text}
        </div>
      ))}
    </div>
  );
}

// ── Document sub-tab content ─────────────────────
function DocumentContent({ documents }) {
  const [activeVersion, setActiveVersion] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);

  if (documents.length === 0) {
    return (
      <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        No document versions yet…
      </div>
    );
  }

  const currentIdx = activeVersion !== null ? activeVersion : documents.length - 1;
  const current = documents[currentIdx];
  const prevDoc = currentIdx > 0 ? documents[currentIdx - 1] : null;

  const handleCopy = async () => {
    if (current?.content) {
      await navigator.clipboard.writeText(current.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      {/* Toolbar row */}
      <div className="flex items-center gap-1.5 mb-3">
        {/* Version pills */}
        <div className="flex gap-1 overflow-x-auto flex-1 pb-0.5">
          {documents.map((doc, i) => {
            const label = doc.version === 'final' ? '✓ Final' : `v${doc.version}`;
            const isActive = i === currentIdx;
            return (
              <button
                key={i}
                onClick={() => { setActiveVersion(i); setShowDiff(false); }}
                className="px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-150 border"
                style={{
                  background: isActive ? 'color-mix(in srgb, var(--color-active) 10%, transparent)' : 'transparent',
                  color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderColor: isActive ? 'color-mix(in srgb, var(--color-active) 25%, transparent)' : 'transparent',
                }}
              >
                {label}
                {doc.action === 'consolidate' && <span className="ml-1 opacity-50 text-[10px]">merged</span>}
              </button>
            );
          })}
        </div>
        {prevDoc && (
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="p-1.5 rounded-md transition-colors"
            style={{ background: showDiff ? 'var(--bg-surface-hover)' : 'transparent' }}
            title="Toggle diff view"
          >
            <GitCompare size={13} style={{ color: showDiff ? 'var(--color-info)' : 'var(--text-muted)' }} />
          </button>
        )}
        <button onClick={handleCopy} className="p-1.5 rounded-md transition-colors" style={{ background: 'transparent' }} title="Copy">
          {copied ? <Check size={13} style={{ color: 'var(--color-success)' }} /> : <Copy size={13} style={{ color: 'var(--text-muted)' }} />}
        </button>
      </div>

      {/* Document body */}
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={`${currentIdx}-${showDiff}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg overflow-hidden overflow-y-auto"
            style={{ background: 'var(--bg-surface)' }}
          >
            {showDiff && prevDoc ? (
              <DiffView oldContent={prevDoc.content} newContent={current.content} />
            ) : (
              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed p-3" style={{ color: 'var(--text-secondary)' }}>
                {current.content}
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Result sub-tab content ───────────────────────
function ResultContent({ result }) {
  const [copied, setCopied] = useState(false);

  if (!result) {
    return (
      <div className="py-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        Waiting for final result…
      </div>
    );
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'result.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Toolbar */}
      <div className="flex items-center justify-end gap-1.5 mb-3">
        <button onClick={handleCopy} className="p-1.5 rounded-md transition-colors" style={{ background: 'transparent' }} title="Copy">
          {copied ? <Check size={13} style={{ color: 'var(--color-success)' }} /> : <Copy size={13} style={{ color: 'var(--text-muted)' }} />}
        </button>
        <button onClick={handleDownload} className="p-1.5 rounded-md transition-colors" style={{ background: 'transparent' }} title="Download">
          <Download size={13} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>

      {/* Rendered markdown */}
      <div
        className="rounded-lg overflow-y-auto px-8 py-6"
        style={{ background: 'var(--bg-base)' }}
      >
        <div className="md-result max-w-none">
          <ReactMarkdown>{result}</ReactMarkdown>
        </div>
      </div>
    </>
  );
}

// ── Combined Panel ───────────────────────────────
export default function OutputPanel({ documents, result, status, tabOverride }) {
  const [tab, setTab] = useState(tabOverride || 'document');

  // If tabOverride changes, follow it
  useEffect(() => {
    if (tabOverride) setTab(tabOverride);
  }, [tabOverride]);

  // Auto-switch to result tab when workflow completes (only when not overridden)
  useEffect(() => {
    if (!tabOverride && result && status === 'done') setTab('result');
  }, [result, status, tabOverride]);

  // When used in tabOverride mode, render content directly without wrapper/tab bar
  if (tabOverride) {
    return (
      <>
        {tabOverride === 'document' && <DocumentContent documents={documents} />}
        {tabOverride === 'result' && <ResultContent result={result} />}
      </>
    );
  }

  const hasDocuments = documents.length > 0;
  const hasResult = Boolean(result);
  if (!hasDocuments && !hasResult) return null;

  const tabs = [
    { id: 'document', label: 'Document', icon: FileText, badge: hasDocuments ? documents.length : 0 },
    { id: 'result',   label: 'Result',   icon: Sparkles, badge: hasResult ? 1 : 0 },
  ];

  return (
    <div className="panel rounded-xl p-5">
      {/* Tab bar */}
      <div className="flex items-center gap-1 mb-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="relative px-3 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors"
              style={{ color: active ? 'var(--text-primary)' : 'var(--text-muted)' }}
            >
              <Icon size={13} style={{ color: active ? (t.id === 'result' ? 'var(--color-success)' : 'var(--color-info)') : 'var(--text-muted)' }} />
              {t.label}
              {t.badge > 0 && !active && (
                <span
                  className="ml-1 w-4 h-4 rounded-full text-[10px] flex items-center justify-center font-bold"
                  style={{
                    background: t.id === 'result' ? 'var(--color-success)' : 'var(--color-active)',
                    color: 'white',
                  }}
                >
                  {t.badge > 9 ? '9+' : t.badge}
                </span>
              )}
              {active && (
                <motion.div
                  layoutId="output-tab-underline"
                  className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                  style={{ background: t.id === 'result' ? 'var(--color-success)' : 'var(--color-active)' }}
                />
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }}
        >
          {tab === 'document' && <DocumentContent documents={documents} />}
          {tab === 'result' && <ResultContent result={result} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
