import Anthropic from "@anthropic-ai/sdk";

let client: Anthropic | null = null;

export function getClaudeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return null;
  }

  if (!client) {
    client = new Anthropic({ apiKey });
  }

  return client;
}

export function getClaudeModel(envVar = "ANTHROPIC_MODEL", fallback = "claude-sonnet-5") {
  return process.env[envVar] ?? fallback;
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};
