const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/llama-3.1-nemotron-70b-instruct:free";

export type OpenRouterConfig = {
  apiKey?: string;
  model?: string;
  referer?: string;
  title?: string;
};

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function getOpenRouterModel(config?: OpenRouterConfig): string {
  const configured = config?.model?.trim() || process.env.OPENROUTER_MODEL?.trim();
  return configured || DEFAULT_MODEL;
}

export function isOpenRouterEnabled(config?: OpenRouterConfig): boolean {
  return Boolean(config?.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim());
}

export async function openRouterChat(messages: OpenRouterMessage[], maxTokens = 420, config?: OpenRouterConfig): Promise<string | null> {
  const apiKey = config?.apiKey?.trim() || process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);

  try {
    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config?.referer?.trim() || process.env.APP_BASE_URL?.trim() || "http://localhost:3000",
        "X-Title": config?.title?.trim() || "gl-recon"
      },
      body: JSON.stringify({
        model: getOpenRouterModel(config),
        messages,
        temperature: 0.1,
        max_tokens: maxTokens
      })
    });

    if (!response.ok) {
      return null;
    }

    const payload = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return null;
    }
    return String(content);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function extractJsonObject(raw: string): Record<string, unknown> {
  const text = raw.trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      return {};
    }
    try {
      return JSON.parse(text.slice(first, last + 1)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}