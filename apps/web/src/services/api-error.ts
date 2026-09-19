export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export function formatErrorMessage(data: unknown, fallbackMessage: string): string {
  const genericMessages = new Set(['bad request', 'bad request exception']);
  const messages: string[] = [];
  const seen = new Set<unknown>();

  const collect = (value: unknown): void => {
    if (!value || seen.has(value)) return;
    if (typeof value === 'string') {
      const message = value.trim();
      if (message && !genericMessages.has(message.toLowerCase())) messages.push(message);
      return;
    }
    if (Array.isArray(value)) {
      seen.add(value);
      value.forEach(collect);
      return;
    }
    if (typeof value === 'object') {
      seen.add(value);
      const record = value as Record<string, unknown>;
      // NestJS commonly puts the useful detail in message, but proxies and
      // validation libraries may wrap it one level deeper.
      collect(record.message);
      collect(record.messages);
      collect(record.details);
      collect(record.errors);
      collect(record.error);
      collect(record.response);
    }
  };

  collect(data);
  return [...new Set(messages)].join(', ') || fallbackMessage;
}

export async function parseApiError(response: globalThis.Response, fallbackMessage: string): Promise<ApiError> {
  const status = response.status;
  const body = await response.text();
  if (!body.trim()) return new ApiError(fallbackMessage, status);

  try {
    const data: unknown = JSON.parse(body);
    const message = formatErrorMessage(data, fallbackMessage);
    return new ApiError(message, status, data);
  } catch {
    return new ApiError(formatErrorMessage(body, fallbackMessage), status);
  }
}
