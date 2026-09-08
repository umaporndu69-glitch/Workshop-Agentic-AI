const GEMINI_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);

export function toGeminiSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...schema };
  if (typeof result.type === 'string' && GEMINI_TYPES.has(result.type)) {
    result.type = result.type.toUpperCase();
  }
  if (result.properties && typeof result.properties === 'object' && !Array.isArray(result.properties)) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(result.properties as Record<string, unknown>)) {
      properties[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? toGeminiSchema(value as Record<string, unknown>) : value;
    }
    result.properties = properties;
  }
  if (result.items && typeof result.items === 'object' && !Array.isArray(result.items)) {
    result.items = toGeminiSchema(result.items as Record<string, unknown>);
  }
  return result;
}