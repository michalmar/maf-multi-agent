import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, GitCompare, Copy, Check } from 'lucide-react';
import { getAgentConfig } from '../agentConfig';

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
              line.type === 'remove' ? 'rgba(239, 68, 68, 0.08)' :
              'transparent',
            color:
              line.type === 'add' ? '#34D399' :
              line.type === 'remove' ? '#F87171' :
              'var(--text-secondary)',
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

export default function DocumentViewer({ documents }) {
  const [activeTab, setActiveTab] = useState(null);
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);

  if (documents.length === 0) return null;

  const currentIdx = activeTab !== null ? activeTab : documents.length - 1;
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
    <div className="glass rounded-2xl p-5">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <FileText size={15} style={{ color: 'var(--color-info)' }} />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Document</h2>
        <div className="ml-auto flex items-center gap-1.5">
          {/* Diff toggle */}
          {prevDoc && (
            <button
              onClick={() => setShowDiff(!showDiff)}
              className={`p-1.5 rounded-md transition-colors ${showDiff ? 'bg-white/10' : 'hover:bg-white/5'}`}
              title="Toggle diff view"
            >
              <GitCompare size={13} style={{ color: showDiff ? 'var(--color-info)' : 'var(--text-muted)' }} />
            </button>
          )}
          {/* Copy button */}
          <button onClick={handleCopy} className="p-1.5 rounded-md hover:bg-white/5 transition-colors" title="Copy content">
            {copied ? <Check size={13} style={{ color: 'var(--color-success)' }} /> : <Copy size={13} style={{ color: 'var(--text-muted)' }} />}
          </button>
        </div>
      </div>

      {/* Version tabs */}
      <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
        {documents.map((doc, i) => {
          const label = doc.version === 'final' ? '✓ Final' : `v${doc.version}`;
          const isActive = i === currentIdx;
          return (
            <button
              key={i}
              onClick={() => { setActiveTab(i); setShowDiff(false); }}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 border ${
                isActive
                  ? 'border-blue-500/30 text-white'
                  : 'border-transparent hover:bg-white/5'
              }`}
              style={{
                background: isActive ? 'color-mix(in srgb, var(--color-active) 15%, transparent)' : 'transparent',
                color: isActive ? 'white' : 'var(--text-muted)',
              }}
            >
              {label}
              {doc.action === 'consolidate' && (
                <span className="ml-1 opacity-50 text-[10px]">merged</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <AnimatePresence mode="wait">
        {current && (
          <motion.div
            key={`${currentIdx}-${showDiff}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="rounded-lg overflow-hidden max-h-80 overflow-y-auto"
            style={{ background: 'var(--bg-surface)' }}
          >
            {showDiff && prevDoc ? (
              <DiffView oldContent={prevDoc.content} newContent={current.content} />
            ) : (
              <pre
                className="text-sm whitespace-pre-wrap font-sans leading-relaxed p-3"
                style={{ color: 'var(--text-secondary)' }}
              >
                {current.content}
              </pre>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
