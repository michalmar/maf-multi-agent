export interface StarterPrompt {
  title: string;
  subtitle: string;
  icon: string;
  query: string;
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    title: "Maintenance brief",
    subtitle: "Predictive maintenance multi-agent workflow",
    icon: "Wrench",
    query:
      "Assess the health of Emerson gas compressor COMP-001 in Houston, Texas. Use the Fabric data sources to identify any abnormal operating patterns, check the vendor maintenance guide PDF to determine whether the behavior breaches advisory or alarm thresholds, and use external context if relevant. Then summarize the issue, likely cause, confidence level, and recommended next maintenance action.",
  },
  {
    title: "List my tools",
    subtitle: "Browse and inspect factory equipment details",
    icon: "Factory",
    query:
      "Browse my equipment inventory and list all registered tools and machines in the factory. For each, show the equipment ID, type, location, and current operational status. Highlight any items flagged for upcoming predictive maintenance or that have recent anomaly alerts.",
  },
];
