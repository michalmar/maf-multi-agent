import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Send, Loader2, Plane, Palmtree, Briefcase, Compass, Sparkles } from 'lucide-react';

const STARTER_TASKS = [
  {
    icon: Plane,
    label: 'Weekend in London',
    query: "I'm in Prague and want a 3-day trip to London next week. Find reasonable flights and a mid-range hotel near good public transport. Do not ask follow up questions, use best effort judgment.",
  },
  {
    icon: Palmtree,
    label: 'Beach vacation',
    query: "Plan a 7-day beach vacation for two from New York. Budget is $4000 total. Looking for warm weather, good snorkeling, and relaxed vibe. Find flights and a beachfront hotel. Do not ask follow up questions, use best effort judgment.",
  },
  {
    icon: Briefcase,
    label: 'Business trip',
    query: "I need a 2-day business trip to Munich from Vienna next Monday. Find morning flights and a hotel within walking distance to the convention center. Prefer hotels with good WiFi and a quiet workspace. Do not ask follow up questions, use best effort judgment.",
  },
  {
    icon: Compass,
    label: 'Adventure travel',
    query: "Plan a 5-day adventure trip to Iceland from London. Interested in glaciers, northern lights, and hot springs. Budget around £2500. Find flights and accommodation near the Golden Circle route. Do not ask follow up questions, use best effort judgment.",
  },
  {
    icon: Sparkles,
    label: 'Predictive Maintenance',
    query: "an offshore gas compression train shows rising vibration and temperature drift, so the system runs a closed operational loop - investigate and recommend next steps",
  },
];

export default function QueryInput({ onRun, disabled }) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim() && !disabled) {
      onRun(query.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="panel rounded-xl p-4 mb-4">
      <label className="block text-[11px] font-medium mb-2 uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        Describe your task
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
          placeholder="Describe what you'd like the agents to work on…"
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

      {/* Starter tasks */}
      {!disabled && !query.trim() && (
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="text-[10px] font-medium uppercase tracking-widest self-center mr-1" style={{ color: 'var(--text-muted)' }}>
            Try
          </span>
          {STARTER_TASKS.map((task) => {
            const Icon = task.icon;
            return (
              <button
                key={task.label}
                type="button"
                onClick={() => setQuery(task.query)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
                style={{
                  background: 'var(--bg-base)',
                  color: 'var(--text-secondary)',
                  border: '1px solid var(--border-subtle)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-accent)';
                  e.currentTarget.style.color = 'var(--text-primary)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border-subtle)';
                  e.currentTarget.style.color = 'var(--text-secondary)';
                }}
              >
                <Icon size={13} style={{ color: 'var(--text-muted)' }} />
                {task.label}
              </button>
            );
          })}
        </div>
      )}
    </form>
  );
}
