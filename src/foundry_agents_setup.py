"""One-time setup: create Foundry sub-agents and print their IDs.

Run this script once to provision the flights-agent and hotels-agent
in your Azure AI Foundry project. Copy the printed IDs into your .env file.

Usage:
    python -m src.foundry_agents_setup
"""

from azure.ai.agents import AgentsClient
from azure.identity import DefaultAzureCredential
from dotenv import load_dotenv

from src.config import load_config


def main() -> None:
    load_dotenv()
    config = load_config()

    if not config.project_endpoint:
        print("ERROR: PROJECT_ENDPOINT not set in .env")
        return
    if not config.model_deployment_name:
        print("ERROR: MODEL_DEPLOYMENT_NAME not set in .env")
        return

    client = AgentsClient(
        endpoint=config.project_endpoint,
        credential=DefaultAzureCredential(),
    )

    flights_agent = client.create_agent(
        model=config.model_deployment_name,
        name="flights-agent",
        instructions=(
            "You are a flight planning specialist. "
            "Given origin, destination, dates, budget, and preferences, "
            "propose 2-3 reasonable flight options with timing, price estimates, "
            "and tradeoffs (direct vs layover, budget vs comfort)."
        ),
    )

    hotels_agent = client.create_agent(
        model=config.model_deployment_name,
        name="hotels-agent",
        instructions=(
            "You are a hotel and neighborhood specialist. "
            "Given a city, dates, budget, and preferences, "
            "suggest 2-3 neighborhoods with hotel ideas, short pros/cons, "
            "and public transport accessibility notes."
        ),
    )

    print(f"\nAgent creation successful!")
    print(f"FLIGHTS_AGENT_ID={flights_agent.id}")
    print(f"HOTELS_AGENT_ID={hotels_agent.id}")
    print("\n→ Add these lines to your .env file")


if __name__ == "__main__":
    main()
