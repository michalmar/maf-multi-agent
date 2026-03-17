export interface StarterPrompt {
  title: string;
  subtitle: string;
  query: string;
}

export const STARTER_PROMPTS: StarterPrompt[] = [
  {
    title: "Weekend city break",
    subtitle: "Fast multi-agent travel planning",
    query:
      "I'm in Prague and want a 3-day trip to London next week. Find reasonable flights and a mid-range hotel near good public transport. Do not ask follow up questions, use best effort judgment.",
  },
  {
    title: "Warm-water escape",
    subtitle: "Flights, hotel, and beach mood fit",
    query:
      "Plan a 7-day beach vacation for two from New York. Budget is $4000 total. Looking for warm weather, good snorkeling, and a relaxed vibe. Find flights and a beachfront hotel. Do not ask follow up questions, use best effort judgment.",
  },
  {
    title: "Executive shuttle",
    subtitle: "Practical business-travel routing",
    query:
      "I need a 2-day business trip to Munich from Vienna next Monday. Find morning flights and a hotel within walking distance to the convention center. Prefer hotels with good WiFi and a quiet workspace. Do not ask follow up questions, use best effort judgment.",
  },
  {
    title: "Maintenance brief",
    subtitle: "Non-travel specialist-agent workflow",
    query:
      "Assess the health of Emerson gas compressor COMP-001 in Houston, Texas. Use the Fabric data sources to identify any abnormal operating patterns, check the vendor maintenance guide PDF to determine whether the behavior breaches advisory or alarm thresholds, and use external context if relevant. Then summarize the issue, likely cause, confidence level, and recommended next maintenance action.",
  },
];
