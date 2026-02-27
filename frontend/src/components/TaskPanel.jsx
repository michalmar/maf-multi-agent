import React from 'react';

export default function TaskPanel({ tasks }) {
  if (tasks.length === 0) return null;

  const total = tasks.length;
  const done = tasks.filter((t) => t.finished).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
      <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
        <span>📋</span> Tasks
      </h2>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-400 mb-1.5">
          <span>{done} / {total} completed</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Task list */}
      <div className="space-y-2">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`flex items-start gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              task.finished
                ? 'bg-emerald-950/20 border border-emerald-800/30'
                : 'bg-gray-800/50 border border-gray-700/30'
            }`}
          >
            <span className="mt-0.5 text-base shrink-0">
              {task.finished ? '✅' : '⏳'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500">#{task.id}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                  task.assigned_to.includes('flight') ? 'bg-blue-900/40 text-blue-300' :
                  task.assigned_to.includes('hotel') ? 'bg-amber-900/40 text-amber-300' :
                  'bg-gray-800 text-gray-400'
                }`}>
                  {task.assigned_to}
                </span>
              </div>
              <p className={`mt-1 ${task.finished ? 'text-gray-400 line-through' : 'text-gray-200'}`}>
                {task.text}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
