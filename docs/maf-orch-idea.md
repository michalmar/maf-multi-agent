You can implement this by treating each Azure AI Foundry Agent as a Python “tool function” and wiring those tools into a Microsoft Agent Framework (MAF) `ChatAgent` that acts as the orchestrator.  The orchestrator runs locally in MAF, while each sub‑agent runs remotely in Azure AI Foundry and is invoked over the Azure AI Agents/Projects SDK. [learn.microsoft](https://learn.microsoft.com/en-us/agent-framework/overview/)

***

## Target architecture

Microsoft Agent Framework is an open‑source, multi‑language SDK for building and orchestrating AI agents and multi‑agent workflows in Python and .NET.  It lets you attach tools (plain Python callables or wrapped agents) to a `ChatAgent` and also provides orchestration builders (sequential, concurrent, MAGENTIC, etc.) for multi‑agent workflows. [github](https://github.com/microsoft/agent-framework)

Azure AI Foundry’s Agent Service hosts “server‑side” agents that expose threads, messages, and runs as first‑class concepts, with the Azure AI Agents/Projects SDKs providing `AgentsClient`/`AIProjectClient` for creation and invocation.  Within Foundry itself, multiple agents are commonly composed by exposing child agents as tools (e.g., `ConnectedAgentTool`), which is conceptually the same pattern we’ll reproduce from MAF by calling them via the SDK. [learn.microsoft](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/overview?view=foundry-classic)

***

## Scenario: simple travel planner

To keep the example small but realistic, we’ll build:

- A **MAF orchestrator agent**: “TravelOrchestrator,” which talks to the user and decides which sub‑agent(s) to call.
- Two **Foundry sub‑agents**:
  - `flights-agent`: specialized in flight options.
  - `hotels-agent`: specialized in hotels and neighborhoods.

The orchestrator runs locally (or in your own compute) using MAF, and when it needs domain‑specific work, it calls the Foundry agents via the Azure AI Projects/Agents SDK. [learn.microsoft](https://learn.microsoft.com/en-us/azure/ai-foundry/how-to/develop/sdk-overview?view=foundry-classic)

***

## Prerequisites and setup

MAF Python and Azure AI SDKs are both installed from PyPI.  At minimum you’ll want: [pypi](https://pypi.org/project/agent-framework/)

```bash
pip install --pre agent-framework
pip install azure-ai-projects azure-identity
# or, if you prefer direct agents client:
pip install azure-ai-agents azure-identity
```

Azure AI Foundry projects are accessed via a **project endpoint** like `https://<AIFoundryResource>.services.ai.azure.com/api/projects/<ProjectName>`, and the standard quickstart uses `AIProjectClient` with `DefaultAzureCredential`.  You’ll typically set environment variables such as `PROJECT_ENDPOINT` and `MODEL_DEPLOYMENT_NAME` for the Foundry project and deployment you’ll use. [learn.microsoft](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/quickstart?view=foundry-classic)

***

## Step 1: define Foundry sub‑agents

First, create the `flights-agent` and `hotels-agent` in your Azure AI Foundry project using the Python quickstart pattern (or via the portal and just capture their IDs). [learn.microsoft](https://learn.microsoft.com/en-us/python/api/overview/azure/ai-agents-readme?view=azure-python)

```python
# foundry_agents_setup.py
import os
from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient

PROJECT_ENDPOINT = os.environ["PROJECT_ENDPOINT"]
MODEL_DEPLOYMENT_NAME = os.environ["MODEL_DEPLOYMENT_NAME"]

project_client = AIProjectClient(
    endpoint=PROJECT_ENDPOINT,
    credential=DefaultAzureCredential(),
)

with project_client:
    flights_agent = project_client.agents.create_agent(
        model=MODEL_DEPLOYMENT_NAME,
        name="flights-agent",
        instructions=(
            "You are a flight planning specialist. "
            "Given origin, destination, dates, budget, and preferences, "
            "propose reasonable flight options and tradeoffs."
        ),
    )

    hotels_agent = project_client.agents.create_agent(
        model=MODEL_DEPLOYMENT_NAME,
        name="hotels-agent",
        instructions=(
            "You are a hotel and neighborhood specialist. "
            "Given a city, dates, and budget, suggest 2‑3 areas and hotel ideas "
            "with short pros/cons."
        ),
    )

print("Flights agent ID:", flights_agent.id)
print("Hotels agent ID:", hotels_agent.id)
```

This follows the same `create_agent` structure as the Foundry quickstart (agent with `model`, `name`, `instructions` and then threads/messages/runs to interact).  In practice you might manage these agents as long‑lived resources (created once, IDs stored in configuration), not re‑creating them per run. [azure.github](https://azure.github.io/AppService/2025/10/31/app-service-agent-framework-part-2.html)

***

## Step 2: wrap Foundry agents as Python “tools”

In Azure AI Agents/Projects, you interact with an agent by creating a thread, adding a user message, and then creating and processing a run, finally reading messages from the thread.  We’ll encapsulate that pattern into Python functions—one per Foundry agent—that can be used as tools by the MAF orchestrator. [learn.microsoft](https://learn.microsoft.com/en-us/python/api/overview/azure/ai-agents-readme?view=azure-python)

```python
# foundry_tools.py
import os
from typing import Optional

from azure.identity import DefaultAzureCredential
from azure.ai.projects import AIProjectClient

PROJECT_ENDPOINT = os.environ["PROJECT_ENDPOINT"]
FLIGHTS_AGENT_ID = os.environ["FLIGHTS_AGENT_ID"]
HOTELS_AGENT_ID = os.environ["HOTELS_AGENT_ID"]

project_client = AIProjectClient(
    endpoint=PROJECT_ENDPOINT,
    credential=DefaultAzureCredential(),
)

def _run_foundry_agent(agent_id: str, user_message: str) -> str:
    """Call a Foundry agent synchronously and return the last assistant message as text."""
    with project_client:
        thread = project_client.agents.threads.create()
        project_client.agents.messages.create(
            thread_id=thread.id,
            role="user",
            content=user_message,
        )

        run = project_client.agents.runs.create_and_process(
            thread_id=thread.id,
            agent_id=agent_id,
        )

        if run.status == "failed":
            # You can add richer error handling / logging here.
            raise RuntimeError(f"Agent run failed: {run.last_error}")

        messages = list(project_client.agents.messages.list(thread_id=thread.id))
        # Grab the last assistant message
        for msg in reversed(messages):
            if msg.role == "assistant":
                # messages[].content structure mirrors the quickstart example
                parts = [c.text.value for c in msg.content if c.type == "text"]
                return "\n".join(parts) if parts else ""
        return "Agent did not return an assistant message."

def call_flights_agent(task: str) -> str:
    """Ask the flights-agent to handle a flight‑related subtask."""
    return _run_foundry_agent(FLIGHTS_AGENT_ID, task)

def call_hotels_agent(task: str) -> str:
    """Ask the hotels-agent to handle a hotel‑related subtask."""
    return _run_foundry_agent(HOTELS_AGENT_ID, task)
```

This mirrors the Foundry Python quickstart’s thread/message/run lifecycle but hides the details behind simple callables.  Conceptually, this is very similar to how the SDK exposes built‑in tools (e.g., `BingGroundingTool`, `CodeInterpreterTool`) whose `.definitions` are added to the agent, except that we’re implementing the tool invocation ourselves instead of letting the platform do server‑side orchestration. [pypi](https://pypi.org/project/azure-ai-agents/)

***

## Step 3: build the MAF orchestrator agent

In MAF, a `ChatAgent` (or an `AzureChatClient` converted to an agent) can take Python functions as tools and use tool calling to decide when to invoke them.  The docs show passing callables directly into the `tools` parameter and using instructions to guide when each tool should be used. [learn.microsoft](https://learn.microsoft.com/en-us/agent-framework/agents/tools/function-tools)

```python
# orchestrator.py
import asyncio
from typing import Annotated

from pydantic import Field
from agent_framework.azure import AzureChatClient
from agent_framework import ChatAgent
from azure.identity import AzureCliCredential

from foundry_tools import call_flights_agent, call_hotels_agent

# Optional: structured tool signatures using Annotated + Field for better descriptions
FlightTask = Annotated[
    str,
    Field(
        description=(
            "A detailed description of the flight planning subtask, "
            "including origin, destination, dates, and constraints."
        )
    ),
]

HotelTask = Annotated[
    str,
    Field(
        description=(
            "A detailed description of the hotel planning subtask, "
            "including city, dates, budget, and preferences."
        )
    ),
]

def flights_tool(task: FlightTask) -> str:
    """Use the flights-agent to propose flight options for the user."""
    return call_flights_agent(task)

def hotels_tool(task: HotelTask) -> str:
    """Use the hotels-agent to propose hotel areas and options for the user."""
    return call_hotels_agent(task)

async def main() -> None:
    # 1) Create an Azure-backed chat client for the orchestrator
    chat_client = AzureChatClient(
        credential=AzureCliCredential(),
        # model_id depends on how Agent Framework is configured with Azure; this is analogous
        # to OpenAIChatClient / AzureOpenAIChatClient usage in the docs.
    )

    # 2) Turn it into a ChatAgent with tools
    orchestrator = chat_client.as_agent(
        name="travel-orchestrator",
        instructions=(
            "You are a travel planning orchestrator.\n"
            "- Use 'flights_tool' when the user asks about flights, routes, or flight timing.\n"
            "- Use 'hotels_tool' when the user asks about where to stay, neighborhoods, or hotels.\n"
            "- Break the user request into sub‑tasks if needed and call tools multiple times.\n"
            "- Then synthesize a concise, end‑to‑end travel plan for the user.\n"
        ),
        tools=[flights_tool, hotels_tool],
    )

    # 3) Run a simple conversation
    user_request = (
        "I’m in Prague and want a 3‑day trip to London next month. "
        "Find reasonable flights and a mid‑range hotel near good public transport."
    )

    response = await orchestrator.run(user_request)
    print("Final orchestrator response:\n")
    print(response.text)

if __name__ == "__main__":
    asyncio.run(main())
```

The pattern of passing plain functions as `tools` with rich descriptions and type annotations is exactly how MAF expects function tools to be registered.  The orchestrator’s instructions give the LLM‑powered agent a policy for when to call each tool, analogous to the examples in the tools documentation and multi‑agent orchestrations tutorials. [learn.microsoft](https://learn.microsoft.com/en-us/python/api/agent-framework-core/agent_framework.chatagent?view=agent-framework-python-latest)

***

## Step 4: (optional) add MAF workflow orchestration

If you later want a more explicit, graph‑like orchestration (for example: orchestrator → flights-agent → hotels-agent → summarizer), you can wrap your orchestrator or Foundry‑backed tools into MAF workflows.  MAF provides `SequentialBuilder` and `ConcurrentBuilder` so you can mix `ChatAgent` participants with custom `Executor` classes for post‑processing or summarization. [learn.microsoft](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/)

For example, you could add a summarizer `Executor` that takes the full conversation (including tool calls) and appends a short bullet‑point summary, similar to the “content → summarizer” example in the MAF docs.  This allows you to keep Foundry doing the heavy domain work while MAF owns higher‑level control flow and aggregation. [elbruno](https://elbruno.com/2025/12/01/introducing-the-microsoft-agent-framework-a-dev-friendly-recap/)

***

## How the end‑to‑end flow works

At runtime, the user only talks to the MAF `travel-orchestrator` agent, which uses its LLM to understand the request and decide whether to call `flights_tool`, `hotels_tool`, or both.  When it calls a tool, the corresponding Python function synchronously invokes the relevant Foundry agent using the Azure AI Projects SDK (threads, messages, runs), then returns a textual result back into the MAF conversation. [learn.microsoft](https://learn.microsoft.com/en-us/agent-framework/agents/tools/)

You get the advantages of server‑side Foundry agents—managed execution, persistence, and observability—while using MAF as a local, provider‑agnostic orchestration layer that could also integrate other tools or agents (OpenAI, MCP tools, internal APIs, etc.).  This architecture is aligned with Microsoft’s guidance that Agent Framework is best suited for local multi‑agent orchestration in code, and it can be paired with the Foundry SDK when you want those agents to run against Foundry‑hosted models or agents. [learn.microsoft](https://learn.microsoft.com/en-us/azure/ai-foundry/how-to/develop/sdk-overview?view=foundry-classic)

***

## Design considerations and variations

- **State and threads**: For simple queries, creating a fresh Foundry thread per tool call is fine; for more complex workflows you may want to reuse a thread per sub‑agent to preserve its own conversation context across multiple orchestrator turns. [learn.microsoft](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/overview?view=foundry-classic)
- **Error handling and timeouts**: Wrap `_run_foundry_agent` with robust error handling, logging, and (optionally) retries, similar to how server‑side tool orchestration in Foundry surfaces structured errors and run status. [learn.microsoft](https://learn.microsoft.com/en-us/azure/ai-foundry/agents/quickstart?view=foundry-classic)
- **Routing vs explicit tool choice**: You can let the orchestrator choose tools automatically (`tool_choice="auto"`) or pass an explicit `tool_choice` dict if you implement your own routing logic based on the user’s utterance, akin to how Foundry’s orchestrators sometimes force specific connected agents by tool name. [learn.microsoft](https://learn.microsoft.com/en-us/answers/questions/5621043/azure-ai-foundry-orchestration-agent-hallucination)
- **Deployment**: Initially you can run MAF locally (e.g., in a simple FastAPI/Streamlit app), and later containerize it and deploy either on Azure App Service, Container Apps, or even back into Foundry as a hosted custom agent, as shown in multi‑agent production patterns. [youtube](https://www.youtube.com/watch?v=v1Q7rEE3StM)

If you tell me which concrete Foundry agents you already have (or plan to build), I can adapt this pattern into ready‑to‑paste code with your exact agent roles and IDs.