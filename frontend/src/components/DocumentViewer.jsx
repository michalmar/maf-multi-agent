import React, { useState } from 'react';

export default function DocumentViewer({ documents }) {
  const [activeTab, setActiveTab] = useState(null);

  if (documents.length === 0) return null;

  // Use last tab by default
  const currentIdx = activeTab !== null ? activeTab : documents.length - 1;
  const current = documents[currentIdx];

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span>📄</span> Document
      </h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 overflow-x-auto pb-1">
        {documents.map((doc, i) => {
          const label = doc.version === 'final' ? '✓ Final' : `v${doc.version}`;
          const isActive = i === currentIdx;
          return (
            <button
              key={i}
              onClick={() => setActiveTab(i)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-gray-300'
              }`}
            >
              {label}
              {doc.action === 'consolidate' && (
                <span className="ml-1 text-[10px] opacity-60">merged</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {current && (
        <div className="bg-gray-800/50 rounded-lg p-4 max-h-96 overflow-y-auto">
          <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
            {current.content}
          </pre>
        </div>
      )}
    </div>
  );
}
