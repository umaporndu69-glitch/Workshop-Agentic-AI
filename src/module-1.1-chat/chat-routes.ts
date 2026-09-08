import type { Env } from '../env';
import { errorJson, json } from '../lib/http';
import type { ChatMessage, ChatProvider, McpTool, ToolCaller } from './types';
import { runGeminiConversation } from './providers/gemini';
import { runOpenAiCompatConversation } from './providers/openai-compat';

const OPENAI_BASE_URL = 'https://api.openai.com/v1';

export function buildSystemPrompt(): string {
  return 'คุณคือผู้ช่วย AI ภาษาไทยที่สุภาพ กระชับ และช่วยผู้ใช้แก้ปัญหาอย่างเป็นขั้นตอน หากไม่แน่ใจให้บอกตามตรง';
}

export function resolveProvider(value: unknown, env: Env): ChatProvider {
  const provider = typeof value === 'string' ? value : env.DEFAULT_CHAT_PROVIDER;
  return provider === 'openai' || provider === 'openai-compat' ? provider : 'gemini';
}

export function defaultModelFor(provider: ChatProvider, env: Env): string {
  if (provider === 'gemini') return env.GEMINI_MODEL || 'gemini-flash-latest';
  if (provider === 'openai') return env.OPENAI_MODEL || 'gpt-4o-mini';
  return env.OPENAI_COMPAT_MODEL || 'gpt-4o-mini';
}

function resolveApiKey(provider: ChatProvider, env: Env): string | undefined {
  return provider === 'gemini' ? env.GEMINI_API_KEY : provider === 'openai' ? env.OPENAI_API_KEY : env.OPENAI_COMPAT_API_KEY;
}

function resolveBaseUrl(provider: ChatProvider, env: Env): string | undefined {
  return provider === 'openai' ? OPENAI_BASE_URL : provider === 'openai-compat' ? env.OPENAI_COMPAT_BASE_URL : undefined;
}

async function resolveTools(): Promise<{ tools: McpTool[]; callTool: ToolCaller }> {
  return { tools: [], callTool: async () => ({ error: 'ยังไม่มี tool ใน Module 1.1' }) };
}

export async function runChatTurn(options: { provider: ChatProvider; model: string; messages: ChatMessage[]; env: Env }): Promise<{ reply: string; toolTrace: unknown[] }> {
  const { tools, callTool } = await resolveTools();
  const common = { apiKey: resolveApiKey(options.provider, options.env), model: options.model, systemPrompt: buildSystemPrompt(), messages: options.messages, tools, callTool };
  if (options.provider === 'gemini') return runGeminiConversation(common);
  return runOpenAiCompatConversation({ ...common, baseUrl: resolveBaseUrl(options.provider, options.env) });
}

export async function handleChatRoute(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return errorJson('ต้องใช้เมธอด POST', 405);
  let body: unknown;
  try { body = await request.json(); } catch { return errorJson('รูปแบบ JSON ไม่ถูกต้อง', 400); }
  if (!body || typeof body !== 'object') return errorJson('ข้อมูลคำขอไม่ถูกต้อง', 400);
  const input = body as { message?: unknown; history?: unknown; provider?: unknown; model?: unknown };
  if (typeof input.message !== 'string' || !input.message.trim()) return errorJson('กรุณาระบุ message', 400);
  const provider = resolveProvider(input.provider, env);
  const history = Array.isArray(input.history) ? input.history.filter((message): message is ChatMessage => Boolean(message && typeof message === 'object' && ((message as ChatMessage).role === 'user' || (message as ChatMessage).role === 'assistant') && typeof (message as ChatMessage).content === 'string')).slice(-40) : [];
  const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : defaultModelFor(provider, env);
  try {
    const result = await runChatTurn({ provider, model, messages: [...history, { role: 'user', content: input.message }], env });
    return json({ reply: result.reply, provider, model, toolTrace: result.toolTrace });
  } catch (error) {
    console.error('chat provider error', error);
    return json({ reply: 'เกิดข้อผิดพลาดขณะติดต่อ provider กรุณาตรวจสอบการตั้งค่าแล้วลองใหม่', provider, model, toolTrace: [] });
  }
}