import type { ChatMessage, ChatTurnResult, McpTool, ToolCaller } from '../types';

export async function runOpenAiCompatConversation(options: {
  baseUrl?: string; apiKey?: string; model: string; systemPrompt: string; messages: ChatMessage[];
  tools: McpTool[]; callTool: ToolCaller;
}): Promise<ChatTurnResult> {
  if (!options.baseUrl) return { reply: 'ยังไม่ได้ตั้งค่า base URL ของ OpenAI-compatible gateway', toolTrace: [] };
  if (!options.apiKey) return { reply: 'ยังไม่ได้ตั้งค่า API key ของ provider ที่เลือก', toolTrace: [] };
  const messages: Array<Record<string, unknown>> = [{ role: 'system', content: options.systemPrompt }, ...options.messages.map((m) => ({ role: m.role, content: m.content }))];
  const toolTrace = [];
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  for (let round = 0; round < 4; round += 1) {
    const body: Record<string, unknown> = { model: options.model, messages };
    if (options.tools.length) body.tools = options.tools.map((tool) => ({ type: 'function', function: { name: `${tool.serverId}__${tool.name}`, description: tool.description, parameters: tool.inputSchema } }));
    if (options.tools.length) body.tool_choice = 'auto';
    const response = await fetch(`${baseUrl}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${options.apiKey}` }, body: JSON.stringify(body) });
    if (!response.ok) return { reply: `OpenAI-compatible provider ตอบกลับผิดพลาด (${response.status})`, toolTrace };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> };
    const message = data.choices?.[0]?.message;
    if (!message) return { reply: 'provider ไม่ได้ส่งข้อความตอบกลับ', toolTrace };
    if (!message.tool_calls?.length) return { reply: message.content?.trim() || 'provider ไม่ได้ส่งข้อความตอบกลับ', toolTrace };
    messages.push({ role: 'assistant', content: message.content ?? '', tool_calls: message.tool_calls });
    for (const call of message.tool_calls) {
      const separator = call.function.name.indexOf('__');
      const args = JSON.parse(call.function.arguments || '{}') as unknown;
      const output = separator < 0 ? { error: 'ชื่อ tool ไม่ถูกต้อง' } : await options.callTool(call.function.name.slice(0, separator), call.function.name.slice(separator + 2), args);
      toolTrace.push({ serverId: call.function.name.slice(0, separator), toolName: call.function.name.slice(separator + 2), input: args, output });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return { reply: 'การเรียกใช้เครื่องมือวนเกินจำนวนรอบที่กำหนด', toolTrace };
}