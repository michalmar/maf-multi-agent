import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2 } from 'lucide-react';

const DEFAULT_QUERY =
  "I'm in Prague and want a 3-day trip to London next week. " +
  "Find reasonable flights and a mid-range hotel near good public transport. " +
  "Do not ask follow up questions, use best effort judgment.";

export default function QueryInput({ onRun, disabled }) {
  const [query, setQuery] = useState(DEFAULT_QUERY);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim() && !disabled) {
      onRun(query.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="glass rounded-2xl p-4 mb-5">
      <label className="block text-xs font-medium mb-2 uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Describe your travel plan
      </label>
      <div className="flex gap-3 items-stretch">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          rows={2}
          className="flex-1 rounded-xl px-4 py-3 text-sm resize-none transition-all duration-200
                     placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-blue-500/30
                     disabled:opacity-40"
          style={{
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
          }}
          placeholder="E.g., Plan me a 3-day trip to Tokyo..."
        />
        <motion.button
          type="submit"
          disabled={disabled || !query.trim()}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="px-5 rounded-xl text-sm font-medium transition-all duration-200
                     disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          style={{
            background: disabled
              ? 'var(--border-subtle)'
              : 'linear-gradient(135deg, #3B82F6, #818CF8)',
            color: 'white',
            boxShadow: disabled ? 'none' : '0 0 20px rgba(59, 130, 246, 0.15)',
          }}
        >
          {disabled ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              Running
            </>
          ) : (
            <>
              <Send size={15} />
              Run
            </>
          )}
        </motion.button>
      </div>
    </form>
  );
}
