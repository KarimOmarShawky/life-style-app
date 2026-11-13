/**
 * src/features/ai/providers/provider-registry.ts
 *
 * Builds the one configured AI provider. AI_PROVIDER accepts only `gemini`
 * (the environment schema rejects anything else at startup). There is no
 * fallback to another provider: a second provider needs its own approval
 * (Hybrid AI slice AI-6). Without a key the result is null and the AI
 * endpoints answer 503 AI_DISABLED.
 */
import { FetchGeminiClient } from '../gemini-client.js';
import { GeminiAiProvider } from './gemini.adapter.js';
import { AI_PROVIDER_IDS, type AiProvider, type AiProviderId } from './ai-provider.js';

export interface AiProviderConfig {
  provider: AiProviderId;
  geminiApiKey: string;
  geminiModel: string;
  timeoutMs: number;
}

export function createAiProvider(config: AiProviderConfig): AiProvider | null {
  if (!(AI_PROVIDER_IDS as readonly string[]).includes(config.provider)) {
    throw new Error(`Unsupported AI_PROVIDER "${String(config.provider)}"`);
  }
  if (config.geminiApiKey.trim() === '') return null;
  return new GeminiAiProvider(
    new FetchGeminiClient({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      timeoutMs: config.timeoutMs
    })
  );
}
