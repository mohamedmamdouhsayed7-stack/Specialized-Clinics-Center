export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function formatErrorMessage(data: unknown, fallbackMessage: string): string {
  if (!data) return fallbackMessage;

  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed && trimmed.toLowerCase() !== 'bad request exception' && trimmed.toLowerCase() !== 'bad request') {
      return trimmed;
    }
    return fallbackMessage;
  }

  if (typeof data === 'object') {
    const errObj = data as Record<string, unknown>;

    // Case 1: NestJS validation pipe array of error strings
    if (Array.isArray(errObj.message)) {
      const messages = errObj.message
        .map((m) => (typeof m === 'string' ? m.trim() : JSON.stringify(m)))
        .filter(Boolean);
      if (messages.length > 0) {
        return messages.join(', ');
      }
    }

    // Case 2: Specific string message
    if (typeof errObj.message === 'string') {
      const trimmed = errObj.message.trim();
      const lower = trimmed.toLowerCase();
      if (lower && lower !== 'bad request exception' && lower !== 'bad request') {
        return trimmed;
      }
      // If message is generic "Bad Request Exception", check if error field has more details
      if (typeof errObj.error === 'string') {
        const errTrimmed = errObj.error.trim();
        const errLower = errTrimmed.toLowerCase();
        if (errLower && errLower !== 'bad request' && errLower !== 'bad request exception') {
          return errTrimmed;
        }
      }
      return fallbackMessage;
    }

    // Case 3: error property is a specific string
    if (typeof errObj.error === 'string') {
      const errTrimmed = errObj.error.trim();
      const errLower = errTrimmed.toLowerCase();
      if (errLower && errLower !== 'bad request' && errLower !== 'bad request exception') {
        return errTrimmed;
      }
    }
  }

  return fallbackMessage;
}

export async function parseApiError(response: Response, fallbackMessage: string): Promise<ApiError> {
  const status = response.status;
  try {
    const data = await response.json();
    const message = formatErrorMessage(data, fallbackMessage);
    return new ApiError(message, status, data);
  } catch {
    try {
      const text = await response.text();
      if (text && text.trim()) {
        const message = formatErrorMessage(text, fallbackMessage);
        return new ApiError(message, status);
      }
    } catch {
      // ignore
    }
    return new ApiError(fallbackMessage, status);
  }
}
