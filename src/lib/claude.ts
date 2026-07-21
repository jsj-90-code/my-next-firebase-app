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

export function getClaudeModel() {
  return process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
}

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};
