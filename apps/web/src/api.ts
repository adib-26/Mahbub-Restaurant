const API = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

type ErrorPayload = { error?: string };

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('accessToken');
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ErrorPayload;
    throw new Error(body.error || 'Request failed. Please try again.');
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
