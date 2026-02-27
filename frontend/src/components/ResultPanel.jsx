import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronUp, Copy, Check, Download, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

export default function ResultPanel({ result, status }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasResult = Boolean(result);

  // Auto-expand when result arrives
  React.useEffect(() => {
    if (hasResult && status === 'done') setExpanded(true);
  }, [hasResult, status]);

  if (!hasResult && status !== 'done') return null;

  const handleCopy = async () => {
    if (result) {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'result.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl overflow-hidden"
    >
      {/* Header bar - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-5 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <Sparkles size={15} style={{ color: 'var(--color-success)' }} />
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Final Result
        </h2>
        {!expanded && hasResult && (
          <span className="text-xs truncate max-w-md" style={{ color: 'var(--text-muted)' }}>
            {result.substring(0, 80)}…
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {expanded && (
            <>
              <span
                onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                className="p-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
              >
                {copied ? <Check size={13} style={{ color: 'var(--color-success)' }} /> : <Copy size={13} style={{ color: 'var(--text-muted)' }} />}
              </span>
              <span
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                className="p-1.5 rounded-md hover:bg-white/5 transition-colors cursor-pointer"
              >
                <Download size={13} style={{ color: 'var(--text-muted)' }} />
              </span>
            </>
          )}
          <ChevronUp
            size={14}
            className={`transition-transform duration-200 ${expanded ? '' : 'rotate-180'}`}
            style={{ color: 'var(--text-muted)' }}
          />
        </div>
      </button>

      {/* Expandable content */}
      <AnimatePresence>
        {expanded && hasResult && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div
              className="px-5 pb-5 border-t"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <div
                className="mt-4 prose prose-invert prose-sm max-w-none"
                style={{ color: 'var(--text-secondary)' }}
              >
                <ReactMarkdown>{result}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
