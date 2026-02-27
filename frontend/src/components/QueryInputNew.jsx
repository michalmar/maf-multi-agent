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
    <form onSubmit={handleSubmit} className="panel rounded-xl p-4 mb-4">
      <label className="block text-[11px] font-medium mb-2 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        Describe your travel plan
      </label>
      <div className="flex gap-3 items-stretch">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          rows={2}
          className="flex-1 rounded-lg px-4 py-3 text-sm resize-none transition-all duration-150
                     placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-active)]/25
                     disabled:opacity-40"
          style={{
            background: 'var(--bg-base)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
          }}
          placeholder="E.g., Plan me a 3-day trip to Tokyo..."
        />
        <motion.button
          type="submit"
          disabled={disabled || !query.trim()}
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.98 }}
          className="px-6 rounded-lg text-sm font-medium transition-all duration-150
                     disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
          style={{
            background: disabled
              ? 'var(--bg-elevated)'
              : 'var(--color-active)',
            color: 'white',
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
