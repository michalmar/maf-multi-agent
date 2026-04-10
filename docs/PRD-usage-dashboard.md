# PRD: Usage Dashboard

> **Status:** Approved  
> **Author:** Architecture Review  
> **Date:** 2026-04-10  

---

## 1. Problem Statement

With persistent history now in place, there is no way to get a bird's-eye view of platform usage — total runs, usage over time, usage per user, success vs failure rates. The History panel only shows a flat chronological list. Operators and users need a summary dashboard to understand adoption, identify trends, and detect issues.

---

## 2. Solution

Add a **Usage Dashboard** accessible from the mission menu header. It opens as a **modal dialog** (consistent with the existing "What's New" modal pattern) and displays aggregated statistics computed client-side from the existing `/api/history` endpoint.

### Key Design Decisions

1. **Client-side aggregation** — The `/api/history` endpoint already returns all sessions. Computing stats in the browser avoids a new backend endpoint and keeps the feature self-contained.
2. **Modal, not page** — Follows the existing "What's New" modal pattern. No new routes needed.
3. **Pure CSS/SVG charts** — No chart library needed. The app already uses custom SVG visualizations (agent roster graph). Pure CSS bar charts and SVG keep the bundle small.
4. **Progressive loading** — Shows a spinner while fetching, then renders charts. The data is typically <50KB even for hundreds of runs.

---

## 3. User Experience

### 3.1 Access Point

A **BarChart3** icon button is added to the mission menu header (between "What's New" sparkle and theme toggle), labeled "Usage Dashboard".

### 3.2 Modal Layout

```
┌─────────────────────────────────────────────────┐
│  📊 Usage Dashboard                        [X]  │
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐           │
│  │ 127  │ │  23  │ │ 94%  │ │  5   │           │
│  │Total │ │Today │ │ Pass │ │Users │           │
│  │Runs  │ │      │ │ Rate │ │      │           │
│  └──────┘ └──────┘ └──────┘ └──────┘           │
│                                                  │
│  Runs per Day (last 30 days)                     │
│  ┌──────────────────────────────────────────┐   │
│  │ ▇ ▇▇▇▇ ▇▇▇ ▇▇▇▇▇▇ ▇▇▇▇ ▇▇▇▇▇▇ ▇     │   │
│  │ ▇ ▇▇▇▇ ▇▇▇ ▇▇▇▇▇▇ ▇▇▇▇ ▇▇▇▇▇▇ ▇     │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  Usage by User             Status Breakdown      │
│  ┌─────────────────┐      ┌─────────────────┐   │
│  │ user@co  ████ 45│      │ ████████ done 94│   │
│  │ dev@co   ███  32│      │ ██       err   6│   │
│  │ admin@co ██   18│      └─────────────────┘   │
│  └─────────────────┘                             │
│                                                  │
│  Recent Activity                                 │
│  ┌──────────────────────────────────────────┐   │
│  │ 12:05 user@co  "Analyze Q1 sales..."     │   │
│  │ 11:30 dev@co   "Fix deployment..."       │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
└─────────────────────────────────────────────────┘
```

### 3.3 Dashboard Cards

| Card | Data | Visual |
|------|------|--------|
| Total Runs | Count of all history items | Large number |
| Today | Runs from today | Large number |
| Success Rate | % with status="done" | Percentage with color |
| Active Users | Unique user_email count | Large number (super-user only) |
| Runs per Day | Daily run count for last 30 days | CSS bar chart |
| Usage by User | Top users by run count | Horizontal bar chart (super-user only) |
| Status Breakdown | done vs error vs unknown | Horizontal bar chart |
| Recent Activity | Last 10 runs | Compact list |

### 3.4 Single-user vs Super-user

- **Regular user:** Sees only their own data. "Active Users" and "Usage by User" cards are hidden since `user_email` field is not present.
- **Super-user:** Sees all users' data. `user_email` is included in each history item, enabling per-user breakdowns.

---

## 4. Technical Design

### 4.1 No Backend Changes

The existing `GET /api/history` returns sufficient data. The `user_email` field is already included for super-users.

### 4.2 Frontend Components

| File | Purpose |
|------|---------|
| `components/usage-dashboard.tsx` | Modal component with charts |
| `app/globals.css` (additions) | Dashboard-specific styles |
| `components/planner-shell.tsx` (edits) | Add menu button + state |

### 4.3 Data Aggregation (Client-side)

```typescript
interface UsageStats {
  totalRuns: number;
  todayRuns: number;
  successRate: number;
  activeUsers: number;
  dailyCounts: { date: string; count: number }[];
  userCounts: { user: string; count: number }[];
  statusCounts: { status: string; count: number }[];
  recentRuns: HistoryItem[];
}
```

Computed from `HistoryItem[]` array on modal open.

---

## 5. Testing

- **Local dev:** 9 existing sessions in `backend/output/` provide test data.
- **No user_email** in local sessions → user breakdown cards auto-hide.
- **Super-user:** Set `SUPER_USER_EMAIL` locally + use `?user_email=` query param.

---

## 6. Success Criteria

1. ✅ Dashboard accessible from header menu
2. ✅ Shows loading spinner while fetching
3. ✅ Renders all stat cards with correct data
4. ✅ Works with 0 history items (empty state)
5. ✅ Works locally without Easy Auth
6. ✅ Responsive layout on mobile
7. ✅ Matches existing design system (glassmorphism, CSS vars, dark/light theme)
