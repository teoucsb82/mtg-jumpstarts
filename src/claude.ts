// Infrastructure for all Claude API calls:
//  - Semaphore: limits concurrency to avoid hitting Haiku rate limits
//  - withRetry: exponential backoff so transient errors don't crash the run
//  - callAgent: single entry point for every agent call (caching + tool use)

import Anthropic from '@anthropic-ai/sdk';

// ─── Semaphore ────────────────────────────────────────────────────────────────
// Caps simultaneous in-flight Claude calls. With 50+ parallel themes (Avatar),
// firing them all at once risks 429s. A semaphore queues extras and releases
// slots as each call completes.

export class Semaphore {
  private running = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await new Promise<void>(resolve => {
      if (this.running < this.max) { this.running++; resolve(); }
      else this.queue.push(() => { this.running++; resolve(); });
    });
    try {
      return await fn();
    } finally {
      this.running--;
      this.queue.shift()?.();
    }
  }
}

// ─── Retry with exponential backoff ──────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts - 1) throw err;
      const delay = 500 * 2 ** attempt + Math.random() * 200;
      const reason = err instanceof Error ? err.message.slice(0, 100) : String(err);
      console.error(`  ↺ ${label} — retry ${attempt + 1} in ${Math.round(delay)}ms (${reason})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

// ─── callAgent ────────────────────────────────────────────────────────────────
// All Claude calls go through here. Three optimizations in one place:
//
//  1. Semaphore    — respects concurrency cap before dispatching
//  2. Prompt cache — HTML block marked ephemeral; retries within 5 min
//                    hit Anthropic's server cache (~90% cheaper on input)
//  3. Tool use     — `tool_choice: {type:'tool'}` forces the model to call
//                    the named tool, guaranteeing structured JSON output

export async function callAgent<T>(
  client: Anthropic,
  semaphore: Semaphore,
  tool: Anthropic.Tool,
  instructions: string,
  htmlContent: string,
  maxTokens: number,
  model = 'claude-haiku-4-5-20251001',
): Promise<T> {
  return semaphore.run(async () => {
    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: instructions },
          { type: 'text', text: htmlContent, cache_control: { type: 'ephemeral' } },
        ],
      }],
    });

    if (response.stop_reason === 'max_tokens') {
      throw new Error(`Response truncated (hit max_tokens=${maxTokens}) for tool ${tool.name}`);
    }

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );
    if (!toolUse) {
      throw new Error(`Agent did not call ${tool.name} (stop_reason: ${response.stop_reason})`);
    }

    return toolUse.input as T;
  });
}
