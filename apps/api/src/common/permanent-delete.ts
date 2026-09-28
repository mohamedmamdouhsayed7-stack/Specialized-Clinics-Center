import { ConflictException } from '@nestjs/common';

/** Convert a late FK race into a safe business error; Prisma rolls the transaction back first. */
export async function runPermanentDelete<T>(operation: () => Promise<T>, conflictMessage: string): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code === 'P2003' || code === 'P2014') throw new ConflictException(conflictMessage);
    throw error;
  }
}
