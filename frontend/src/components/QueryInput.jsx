import React, { useState } from 'react';

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
    <form onSubmit={handleSubmit} className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <label className="block text-sm font-medium text-gray-400 mb-2">
        Describe your travel plan
      </label>
      <textarea
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={disabled}
        rows={3}
        className="w-full bg-gray-800 text-gray-100 rounded-lg border border-gray-700 px-4 py-3 text-sm
                   placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500
                   disabled:opacity-50 resize-none"
        placeholder="E.g., Plan me a 3-day trip to Tokyo..."
      />
      <div className="mt-3 flex justify-end">
        <button
          type="submit"
          disabled={disabled || !query.trim()}
          className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium
                     transition-colors disabled:opacity-40 disabled:cursor-not-allowed
                     flex items-center gap-2"
        >
          {disabled ? (
            <>
              <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <span>▶</span> Run
            </>
          )}
        </button>
      </div>
    </form>
  );
}
