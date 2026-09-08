import type { ChatMessage, ChatTurnResult, McpTool, ToolCaller } from '../types';
import { toGeminiSchema } from '../tool-schema';

type GeminiPart = { text?: string; functionCall?: { name: string; args?: unknown }; functionResponse?: unknown };

export async function runGeminiConversation(options: {
  apiKey?: string; model: string; systemPrompt: string; messages: ChatMessage[];
  tools: McpTool[]; callTool: ToolCaller;
}): Promise<ChatTurnResult> {
  if (!options.apiKey) return { reply: 'ยังไม่ได้ตั้งค่า GEMINI_API_KEY จึงยังใช้งาน Gemini ไม่ได้', toolTrace: [] };
  const contents: Array<{ role: 'user' | 'model'; parts: GeminiPart[] }> = options.messages.map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user', parts: [{ text: message.content }],
  }));
  const toolTrace = [];
  const tools = options.tools.length ? [{ functionDeclarations: options.tools.map((tool) => ({
    name: `${tool.serverId}__${tool.name}`, description: tool.description, parameters: toGeminiSchema(tool.inputSchema),
  })) }] : undefined;

  for (let round = 0; round < 4; round += 1) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent?key=${encodeURIComponent(options.apiKey)}`;
    const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: options.systemPrompt }] }, contents, ...(tools ? { tools } : {}) }) });
    if (!response.ok) return { reply: `Gemini ตอบกลับผิดพลาด (${response.status})`, toolTrace };
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: GeminiPart[] } }> };
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const calls = parts.filter((part) => part.functionCall?.name);
    if (!calls.length) return { reply: parts.map((part) => part.text ?? '').join('').trim() || 'Gemini ไม่ได้ส่งข้อความตอบกลับ', toolTrace };
    contents.push({ role: 'model', parts });
    const responses: GeminiPart[] = [];
    for (const part of calls) {
      const name = part.functionCall!.name;
      const separator = name.indexOf('__');
      const output = separator < 0 ? { error: 'ชื่อ tool ไม่ถูกต้อง' } : await options.callTool(name.slice(0, separator), name.slice(separator + 2), part.functionCall?.args ?? {});
      toolTrace.push({ serverId: name.slice(0, separator), toolName: name.slice(separator + 2), input: part.functionCall?.args ?? {}, output });
      responses.push({ functionResponse: { name, response: { content: output } } });
    }
    contents.push({ role: 'user', parts: responses });
  }
  return { reply: 'การเรียกใช้เครื่องมือวนเกินจำนวนรอบที่กำหนด', toolTrace };
}