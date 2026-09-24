export type ModelRequest = Readonly<{ provider: 'openai' | 'anthropic' | 'custom';
  endpoint?: string | null; model: string; instructions: string; input: string;
  maxOutputTokens: number; secret: string }>;
export type ModelResult = Readonly<{ output: string; inputTokens: number; outputTokens: number }>;

const maxResponseBytes = 2 * 1024 * 1024;
const responseText = async (response: Response) => {
  const text = await response.text();
  if (text.length > maxResponseBytes) throw new Error('MODEL_RESPONSE_TOO_LARGE');
  if (!response.ok) throw new Error(`MODEL_PROVIDER_HTTP_${response.status}`);
  return JSON.parse(text) as Record<string, unknown>;
};
const blocks = (value: unknown): string => Array.isArray(value) ? value.flatMap((part: unknown) => {
  if (!part || typeof part !== 'object') return [];
  const node = part as Record<string, unknown>;
  if (node.type === 'output_text' && typeof node.text === 'string') return [node.text];
  if (node.type === 'message') return [blocks(node.content)];
  if (node.type === 'text' && typeof node.text === 'string') return [node.text];
  return [];
}).filter(Boolean).join('\n') : '';
const count = (value: unknown, field: string) => {
  if (!value || typeof value !== 'object') return 0;
  const number = (value as Record<string, unknown>)[field];
  return typeof number === 'number' && Number.isInteger(number) && number >= 0 ? number : 0;
};

/** A single text response; tool calls and arbitrary remote actions are deliberately unavailable. */
export async function invokeModel(request: ModelRequest, fetcher: typeof fetch = fetch): Promise<ModelResult> {
  const endpoint = request.provider === 'openai' ? 'https://api.openai.com/v1/responses' :
    request.provider === 'anthropic' ? 'https://api.anthropic.com/v1/messages' : request.endpoint;
  if (!endpoint || !endpoint.startsWith('https://')) throw new Error('MODEL_ENDPOINT_INVALID');
  const body = request.provider === 'anthropic' ? {
    model: request.model, max_tokens: request.maxOutputTokens,
    system: request.instructions, messages: [{ role: 'user', content: request.input }],
  } : { model: request.model, instructions: request.instructions, input: request.input,
    max_output_tokens: request.maxOutputTokens, store: false };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (request.provider === 'anthropic') {
    headers['x-api-key'] = request.secret;
    headers['anthropic-version'] = '2023-06-01';
  } else headers.Authorization = `Bearer ${request.secret}`;
  const response = await fetcher(endpoint, { method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000), redirect: 'error' });
  const data = await responseText(response);
  const output = typeof data.output_text === 'string' ? data.output_text : blocks(data.output ?? data.content);
  if (!output || output.length > 64_000) throw new Error('MODEL_OUTPUT_INVALID');
  const usage = data.usage;
  return { output, inputTokens: count(usage, request.provider === 'anthropic' ? 'input_tokens' : 'input_tokens'),
    outputTokens: count(usage, request.provider === 'anthropic' ? 'output_tokens' : 'output_tokens') };
}
