import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeModel } from '../dist/providers.js';

test('OpenAI response request uses a bounded text call without storing provider output', async () => {
  let observed;
  const result = await invokeModel({ provider: 'openai', model: 'test-model',
    instructions: 'Stay in scope', input: 'hello', maxOutputTokens: 128,
    secret: 'private-api-key' }, async (url, options) => {
    observed = { url, options };
    return new Response(JSON.stringify({ output: [{ type: 'message', content: [
      { type: 'output_text', text: 'hello back' }] }],
      usage: { input_tokens: 3, output_tokens: 2 } }), { status: 200 });
  });
  assert.equal(observed.url, 'https://api.openai.com/v1/responses');
  assert.equal(JSON.parse(observed.options.body).store, false);
  assert.equal(observed.options.headers.Authorization, 'Bearer private-api-key');
  assert.deepEqual(result, { output: 'hello back', inputTokens: 3, outputTokens: 2 });
});

test('Anthropic response and provider failure are parsed without leaking credentials', async () => {
  const request = { provider: 'anthropic', model: 'test-model', instructions: 'Scope',
    input: 'hello', maxOutputTokens: 128, secret: 'private-api-key' };
  const result = await invokeModel(request, async (_url, options) => {
    assert.equal(options.headers['x-api-key'], 'private-api-key');
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'done' }],
      usage: { input_tokens: 4, output_tokens: 1 } }), { status: 200 });
  });
  assert.equal(result.output, 'done');
  await assert.rejects(invokeModel(request, async () => new Response('bad', { status: 401 })),
    error => error.message === 'MODEL_PROVIDER_HTTP_401');
});
