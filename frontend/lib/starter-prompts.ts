export interface StarterPrompt {
  title: string;
  subtitle: string;
  query: string;
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  
  {
    title: "Maintenance brief",
    subtitle: "Predictive maintenance multi-agent workflow",
    query:
      "Assess the health of Emerson gas compressor COMP-001 in Houston, Texas. Use the Fabric data sources to identify any abnormal operating patterns, check the vendor maintenance guide PDF to determine whether the behavior breaches advisory or alarm thresholds, and use external context if relevant. Then summarize the issue, likely cause, confidence level, and recommended next maintenance action.",
  },
];
