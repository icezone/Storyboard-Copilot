import { openGlobalErrorDialog } from '@/features/app/errorDialogEvents';

export interface ResolvedErrorContent {
  message: string;
  details?: string;
}

interface ErrorWithDetails extends Error {
  details?: string;
}

function stringifyUnknown(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function resolveErrorContent(error: unknown, fallbackMessage: string): ResolvedErrorContent {
  if (error instanceof Error) {
    const errorWithDetails = error as ErrorWithDetails;
    const message = error.message?.trim() || fallbackMessage;
    const detailsStr = stringifyUnknown(errorWithDetails.details);

    // Only include details if they exist and are different from the message
    const shouldIncludeDetails = detailsStr && detailsStr.trim() !== message;

    return {
      message,
      details: shouldIncludeDetails ? detailsStr.trim() : undefined,
    };
  }

  if (typeof error === 'string') {
    const content = error.trim();
    return {
      message: content || fallbackMessage,
      details: undefined, // Don't duplicate the message in details
    };
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    const candidate =
      (typeof record.message === 'string' && record.message) ||
      (typeof record.error === 'string' && record.error) ||
      (typeof record.details === 'string' && record.details) ||
      (typeof record.msg === 'string' && record.msg) ||
      '';
    const message = candidate.trim() || fallbackMessage;
    const detailsJson = stringifyUnknown(record);

    // Only include details if they're different from the message
    const shouldIncludeDetails = detailsJson && detailsJson.trim() !== message;

    return {
      message,
      details: shouldIncludeDetails ? detailsJson.trim() : undefined,
    };
  }

  return { message: fallbackMessage };
}

export async function showErrorDialog(
  text: string,
  title: string,
  details?: string,
  copyText?: string
): Promise<void> {
  const content = text.trim();
  if (!content) {
    return;
  }

  openGlobalErrorDialog({
    title,
    message: content,
    details: details?.trim() || undefined,
    copyText: copyText?.trim() || undefined,
  });
}
