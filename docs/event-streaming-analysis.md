# Event Streaming Analysis — Multi-Agent Orchestration

## Problem Statement

When sub-agents (Foundry agents) are working on tasks, the current solution only shows the final result. During the 10-20 seconds a sub-agent runs, there is no visibility into what's happening. The goal is to have a unified stream of events from the entire orchestration process.

## Current Architecture

```
┌─────────────────────────────────────────────────────┐
│ MAF Orchestrator (agent.run)                        │
│  └─ FunctionInvocationLayer (tool call loop)        │
│      ├─ Iteration 1: LLM → create_tasks()          │
│      ├─ Iteration 2: LLM → call_flights_tool()     │ ← blocks 10-20s, no events
│      │                    → call_hotels_tool()      │ ← blocks 10-20s, no events
│      ├─ Iteration 3: LLM → get_plan_status()       │
│      ├─ ...                                         │
│      └─ Final: LLM → text response                  │
└─────────────────────────────────────────────────────┘
```

**Why events don't propagate today:**
- Foundry sub-agents are invoked synchronously via `run_foundry_agent()` (runs in a separate thread with its own event loop)
- The `responses.create()` call uses `stream=False` — waits for the complete response
- The MAF `FunctionInvocationLayer` blocks on each tool call — no event propagation during tool execution

## Streaming Capabilities (Verified)

### Layer 1: Foundry Sub-Agents (`openai.responses.create`)
✅ **Fully supports streaming** via `stream=True`

Events emitted (tested):
| Event | When | Content |
|-------|------|---------|
| `ResponseCreatedEvent` | Response starts | Response ID |
| `ResponseInProgressEvent` | Processing begins | — |
| `ResponseOutputItemAddedEvent` | New output item | Item metadata |
| `ResponseContentPartAddedEvent` | Content part starts | Part type |
| `ResponseTextDeltaEvent` | Token generated | Text delta (word/chunk) |
| `ResponseTextDoneEvent` | Text complete | Full text |
| `ResponseReasoningSummaryTextDeltaEvent` | Reasoning chunk | Summary delta |
| `ResponseCompletedEvent` | Done | Usage stats |

**Timing observed**: Events arrive within ~100ms of each other once generation starts. First token at ~1.4s after request.

### Layer 2: MAF Orchestrator (`agent.run`)
✅ **Supports streaming** via `agent.run(stream=True)`

Returns `ResponseStream[AgentResponseUpdate, AgentResponse]` — async iterable of updates.

Update content types:
| Content Type | When | Content |
|-------------|------|---------|
| `text_reasoning` | Model is reasoning | Reasoning summary |
| `function_call` | Tool decision made | Tool name + args |
| `text` | Text token generated | Text delta |
| `usage` | Response complete | Token counts |

**Key limitation**: Streaming only covers the orchestrator LLM's output. When it decides to call a tool (e.g., `call_flights_tool`), the stream **pauses** while `FunctionInvocationLayer` executes the tool synchronously. No sub-agent events are visible.

### Layer 3: Cross-Thread Bridge
The current `foundry_client.py` runs sub-agents in a separate thread (via `ThreadPoolExecutor`). Verified that `queue.Queue` (thread-safe) can bridge events between:
- Sub-agent's async loop (in worker thread) → `queue.Queue.put()` 
- Main async loop → `loop.run_in_executor(None, queue.get)` 

## Solution Options

### Option A: Callback-Based Event Emitter ⭐ Recommended

**Approach**: Add a callback/event emitter that all layers push events to. The main loop consumes and displays events in real-time.

```python
# Event types
@dataclass
class AgentEvent:
    timestamp: float
    source: str          # "orchestrator", "flights_tool", "hotels_tool"
    event_type: str      # "reasoning", "tool_decision", "agent_started", 
                         #  "agent_streaming", "agent_completed", "task_completed"
    data: dict           # event-specific payload

# Callback signature
EventCallback = Callable[[AgentEvent], None]
```

**Changes required**:
1. **`foundry_client.py`**: Switch to `stream=True`, emit `agent_started`, `agent_streaming` (text deltas), `agent_completed` events via callback
2. **`dispatcher.py`**: Pass callback through to foundry client
3. **`workflow.py`**: Create callback, wire through dispatch tools, display events as they arrive
4. **`orchestrator.py`**: Reasoning logger already intercepts LLM responses — emit events via same callback

**Pros**: Simple, no framework changes, works with current thread architecture  
**Cons**: Parallel display of events from multiple agents needs careful formatting  
**Effort**: Medium  

### Option B: AsyncIO Queue Stream

**Approach**: Use `asyncio.Queue` as a unified event stream. All components push events, a consumer task displays them.

```python
event_queue: asyncio.Queue[AgentEvent] = asyncio.Queue()

# Producer (in foundry_client, runs in worker thread):
sync_queue.put(AgentEvent(...))  # thread-safe queue

# Bridge (in main loop):
async def bridge_events(sync_queue, async_queue):
    while True:
        event = await loop.run_in_executor(None, sync_queue.get)
        await async_queue.put(event)

# Consumer (in main loop):
async def display_events(async_queue):
    while True:
        event = await async_queue.get()
        render_event(event)
```

**Changes required**: Same as Option A, plus queue infrastructure  
**Pros**: Async-native, supports concurrent consumers (CLI, web, logging)  
**Cons**: More complex thread-bridging; need sentinel values for shutdown  
**Effort**: Medium-High  

### Option C: MAF Agent Streaming + Foundry Streaming (Full Integration)

**Approach**: Use `agent.run(stream=True)` for the orchestrator AND `stream=True` for sub-agents. Merge both streams.

```python
# Orchestrator streams its reasoning/decisions:
stream = agent.run(query, stream=True)
async for update in stream:
    if update has function_call:
        # Sub-agent will execute via FunctionInvocationLayer
        # But we can't intercept the sub-agent's stream here
        pass
    else:
        display(update)
```

**Key challenge**: MAF's `FunctionInvocationLayer` internally handles tool execution. When a tool blocks (sub-agent running), the orchestrator stream is paused. We cannot merge sub-agent streams into the orchestrator stream without modifying the framework.

**Workaround**: Keep orchestrator non-streaming, use reasoning logger (current approach) for orchestrator events, and add streaming only for Foundry sub-agents via callback.

**Pros**: Uses native MAF streaming  
**Cons**: Doesn't solve the core problem (sub-agent events during tool execution)  
**Effort**: High  

### Option D: Server-Sent Events (SSE) Endpoint

**Approach**: Wrap the workflow in a FastAPI/Starlette endpoint that emits SSE.

```python
@app.get("/plan")
async def plan(query: str):
    async def event_generator():
        async for event in run_workflow_with_events(query):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

**Pros**: Standard web pattern, great for UI integration  
**Cons**: Requires web server, overkill for CLI-only usage  
**Effort**: High (but builds on Option A/B internally)  

## Recommendation

### Phase 1: Callback-based streaming for Foundry sub-agents (Option A)

This is the highest-value, lowest-effort change:

1. **Define `AgentEvent` dataclass** and `EventCallback` type
2. **Modify `foundry_client._run_agent_async`** to use `stream=True` and push events via a thread-safe `queue.Queue`
3. **Modify `dispatcher.py`** to accept an event callback and pass it to foundry client
4. **Modify `workflow.py`/`main.py`** to display streaming events from sub-agents

**Expected result**: During the 10-20s a sub-agent works, you'd see:
```
14:31:45 📤 DISPATCH: FLIGHTS-AGENT (tasks: [1, 2])
14:31:46 ✈️  [flights] ▸ Certainly! Here's a comprehensive...
14:31:46 ✈️  [flights] ▸ ### Task 1: Round-Trip Flights...
14:31:47 ✈️  [flights] ▸ **Option 1: Budget Friendly**...
...tokens streaming in real-time...
14:31:55 ✅ FLIGHTS-AGENT completed (10.3s, 3907 chars)
```

### Phase 2: Unified event stream (Option B)

Build on Phase 1 by:
1. Adding `asyncio.Queue` infrastructure
2. Including orchestrator reasoning events in the same stream
3. Supporting concurrent consumers (CLI renderer, log file, future web endpoint)

### Phase 3: SSE/WebSocket endpoint (Option D)

Only if a web UI is needed — builds on the event infrastructure from Phase 1-2.

## Technical Notes

- **Thread boundary**: Foundry sub-agents run in a `ThreadPoolExecutor` with their own `asyncio` event loop. Events must cross from the worker thread to the main loop. Use `queue.Queue` (thread-safe stdlib) as the bridge.
- **Concurrent sub-agents**: If multiple agents run in parallel (future), each pushes to the same queue with a `source` identifier. The consumer interleaves and displays events with agent-specific prefixes.
- **Back-pressure**: For CLI display, no back-pressure needed (we always want all events). For web, SSE handles back-pressure naturally.
