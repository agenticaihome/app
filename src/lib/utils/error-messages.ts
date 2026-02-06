const TRANSACTION_GUIDANCE = "Please reload the page and try again. If the issue persists, reach out via Telegram or GitHub.";

export type FormatOptions = {
    transaction?: boolean;
    prefix?: string;
    fallback?: string;
};

function extractMessageFromError(error: unknown): string | null {
    if (typeof error === "string" && error.trim().length > 0) {
        return error.trim();
    }
    if (error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0) {
        return error.message.trim();
    }
    if (typeof error === "object" && error !== null) {
        const maybeMessage = (error as Record<string, unknown>).message;
        if (typeof maybeMessage === "string" && maybeMessage.trim().length > 0) {
            return maybeMessage.trim();
        }
    }
    return null;
}

export function formatUserFacingError(error: unknown, options: FormatOptions = {}): string {
    const fallback = options.fallback ?? "An unexpected error occurred.";
    const extracted = extractMessageFromError(error);
    const baseMessage = extracted ?? fallback;

    let composed = baseMessage;
    if (options.prefix) {
        composed = `${options.prefix} ${baseMessage}`.trim();
    }
    if (options.transaction) {
        composed = `${composed} ${TRANSACTION_GUIDANCE}`.trim();
    }
    return composed;
}
