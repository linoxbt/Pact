const apiUrl = import.meta.env.VITE_PACT_API_URL as string | undefined;
const legacyApiUrl = import.meta.env.VITE_PACT_LEGACY_API_URL as string | undefined;
const json = (value: unknown) => JSON.stringify(value, (_, field) =>
  typeof field === 'bigint' ? field.toString() : field);

export async function request(path: string, token?: string, body?: unknown,
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') {
  const origin = path.startsWith('/v1/') && legacyApiUrl ? legacyApiUrl : apiUrl;
  if (!origin) throw Error('Set VITE_PACT_API_URL');
  const response = await fetch(new URL(path, origin), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : json(body), redirect: 'error',
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || `API ${response.status}`);
  return data;
}
