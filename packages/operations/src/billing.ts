/** Micro-USD rates per one million tokens, with a 20% Pact service markup. */
export function modelChargeMicro(inputTokens: number, outputTokens: number,
  price: { input: number; output: number }): bigint {
  if (![inputTokens, outputTokens, price.input, price.output].every(
    value => Number.isSafeInteger(value) && value >= 0)) throw new Error('Invalid model usage');
  const weighted = BigInt(inputTokens) * BigInt(price.input) +
    BigInt(outputTokens) * BigInt(price.output);
  return (weighted * 12n + 9_999_999n) / 10_000_000n;
}
