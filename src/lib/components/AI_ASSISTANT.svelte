<script lang="ts">
    import { copyToClipboard } from "$lib/common/share-utils";
    import { hoverCorners } from "$lib/hoverCorners";

    export let prompt: string;
    export let title: string | null = "Still have questions?";
    export let description: string | null =
        "Copy the prompt below and paste it into any AI assistant. It includes a link to the full documentation.";
    export let officialDocsUrl =
        "https://github.com/game-of-prompts/.github/blob/main/profile/README.md";
    export let telegramUrl = "https://t.me/unstopbots";
    export let chatGptBaseUrl = "https://chat.openai.com/?prompt=";
    export let claudeBaseUrl = "https://claude.ai/new?q=";

    let copied = false;
    let copyTimeout: ReturnType<typeof setTimeout> | null = null;

    $: encodedPrompt = encodeURIComponent(prompt);
    $: chatGptUrl = `${chatGptBaseUrl}${encodedPrompt}`;
    $: claudeUrl = `${claudeBaseUrl}${encodedPrompt}`;

    async function handleCopyPrompt() {
        const ok = await copyToClipboard(prompt);
        if (!ok) return;

        copied = true;

        if (copyTimeout) {
            clearTimeout(copyTimeout);
        }

        copyTimeout = setTimeout(() => {
            copied = false;
            copyTimeout = null;
        }, 2200);
    }
</script>

<section class="ai-assistant-panel">
    <div class="ai-assistant-copy">
        {#if title || description}
            <div class="ai-assistant-heading">
                {#if title}
                    <h3 class="ai-assistant-title">{title}</h3>
                {/if}
                {#if description}
                    <p class="ai-assistant-description">{description}</p>
                {/if}
            </div>
        {/if}

        <button
            type="button"
            class="prompt-box"
            on:click={handleCopyPrompt}
            aria-label="Copy AI assistant prompt"
        >
            <span class="prompt-text">{prompt}</span>
            <span class="prompt-copy-icon">
                {#if copied}
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <path d="M20 6 9 17l-5-5"></path>
                    </svg>
                    <span class="copy-label">Copied</span>
                {:else}
                    <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        aria-hidden="true"
                    >
                        <rect x="9" y="9" width="13" height="13" rx="2"></rect>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                    <span class="copy-label">Copy prompt</span>
                {/if}
            </span>
        </button>
    </div>

    <p class="ai-or-label">or open directly in:</p>

    <div class="ai-links-secondary">
        <a
            href={chatGptUrl}
            class="btn-ai-secondary"
            target="_blank"
            rel="noopener noreferrer"
            use:hoverCorners
        >
            ChatGPT ↗
        </a>
        <a
            href={claudeUrl}
            class="btn-ai-secondary"
            target="_blank"
            rel="noopener noreferrer"
            use:hoverCorners
        >
            Claude ↗
        </a>
    </div>

    <p class="ai-disclaimer">
        AI responses may not be fully accurate. Always refer to the
        <a href={officialDocsUrl} target="_blank" rel="noopener noreferrer">
            official documentation
        </a>
        for authoritative information.
    </p>

    <div class="telegram-link">
        <a
            href={telegramUrl}
            class="btn-ai-telegram"
            target="_blank"
            rel="noopener noreferrer"
            use:hoverCorners
        >
            <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
            >
                <path
                    d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"
                ></path>
            </svg>
            <span>Join Telegram Community</span>
        </a>
    </div>
</section>

<style>
    .ai-assistant-panel {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        border-top: 1px solid rgba(74, 222, 128, 0.08);
        margin-top: 0.5rem;
        padding-top: 1.5rem;
    }

    .ai-assistant-copy {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
    }

    .ai-assistant-heading {
        display: flex;
        flex-direction: column;
        gap: 0.6rem;
    }

    .ai-assistant-title {
        margin: 0;
        color: hsl(var(--foreground));
        font-size: 1.05rem;
        font-weight: 700;
        line-height: 1.3;
    }

    .ai-assistant-description {
        margin: 0;
        color: hsl(var(--muted-foreground));
        font-size: 0.92rem;
        line-height: 1.7;
    }

    .prompt-box {
        display: flex;
        width: 100%;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border: 1px solid rgba(74, 222, 128, 0.14);
        border-radius: 1rem;
        background:
            linear-gradient(180deg, rgba(74, 222, 128, 0.06), rgba(74, 222, 128, 0.02)),
            hsl(var(--card) / 0.6);
        color: inherit;
        cursor: pointer;
        padding: 1rem 1rem 1rem 1.1rem;
        text-align: left;
        transition:
            border-color 160ms ease,
            transform 160ms ease,
            box-shadow 160ms ease;
    }

    .prompt-box:hover {
        border-color: rgba(74, 222, 128, 0.28);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
        transform: translateY(-1px);
    }

    .prompt-text {
        color: hsl(var(--foreground));
        font-family: var(--font-mono);
        font-size: 0.83rem;
        line-height: 1.65;
        overflow-wrap: anywhere;
    }

    .prompt-copy-icon {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        flex-shrink: 0;
        border-radius: 999px;
        background: rgba(74, 222, 128, 0.12);
        color: #4ade80;
        padding: 0.55rem 0.8rem;
        white-space: nowrap;
    }

    .copy-label {
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.02em;
    }

    .ai-or-label {
        margin: 0;
        color: hsl(var(--muted-foreground));
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.14em;
    }

    .ai-links-secondary {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
    }

    .btn-ai-secondary,
    .btn-ai-telegram {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 0.55rem;
        min-height: 2.75rem;
        border-radius: 999px;
        text-decoration: none;
        transition:
            transform 160ms ease,
            border-color 160ms ease,
            background 160ms ease;
    }

    .btn-ai-secondary {
        border: 1px solid rgba(74, 222, 128, 0.14);
        background: rgba(74, 222, 128, 0.05);
        color: hsl(var(--foreground));
        padding: 0.75rem 1rem;
        font-size: 0.9rem;
        font-weight: 600;
    }

    .btn-ai-secondary:hover,
    .btn-ai-telegram:hover {
        transform: translateY(-1px);
    }

    .btn-ai-telegram {
        border: 1px solid rgba(74, 222, 128, 0.2);
        background: linear-gradient(135deg, rgba(74, 222, 128, 0.16), rgba(74, 222, 128, 0.06));
        color: #4ade80;
        padding: 0.85rem 1.1rem;
        font-size: 0.92rem;
        font-weight: 700;
        width: fit-content;
    }

    .ai-disclaimer {
        margin: 0;
        color: hsl(var(--muted-foreground));
        font-size: 0.82rem;
        line-height: 1.65;
    }

    .ai-disclaimer a {
        color: #4ade80;
        text-decoration: underline;
        text-underline-offset: 0.14em;
    }

    @media (max-width: 640px) {
        .prompt-box {
            align-items: flex-start;
            flex-direction: column;
        }

        .prompt-copy-icon {
            align-self: stretch;
            justify-content: center;
        }

        .btn-ai-secondary,
        .btn-ai-telegram {
            width: 100%;
        }
    }
</style>
