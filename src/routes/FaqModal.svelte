<script lang="ts">
    import * as Dialog from "$lib/components/ui/dialog";
    import AI_ASSISTANT from "$lib/components/AI_ASSISTANT.svelte";
    import { browser } from "$app/environment";
    import { slide } from "svelte/transition";

    interface FaqItem {
        question: string;
        answer: string;
    }

    interface FaqGroup {
        title: string;
        items: FaqItem[];
    }

    const README_FAQ_URL =
        "https://raw.githubusercontent.com/game-of-prompts/.github/refs/heads/main/profile/README.md";
    const FAQ_ASSISTANT_PROMPT =
        "Please read this Markdown document and answer questions about it: https://raw.githubusercontent.com/game-of-prompts/.github/refs/heads/main/profile/README.md";

    const FALLBACK_GROUPS: FaqGroup[] = [
        {
            title: "General",
            items: [
                {
                    question: "What is Game of Prompts?",
                    answer:
                        "A bot competition audited by blockchain. Creators design game-services to evaluate AI solvers, while players build solver-services to maximize their scores, all verified on the Ergo blockchain.",
                },
                {
                    question: 'What is the "Ceremony Phase"?',
                    answer:
                        "The initial period where players register their Solver IDs to add randomness to the seed. This prevents the Creator from pre-calculating solutions and helps keep competition fair.",
                },
                {
                    question: "What do I need to play?",
                    answer:
                        "An Ergo Wallet with some ERG for participation fees, plus a Celaut Node to run game and solver services locally.",
                },
            ],
        },
        {
            title: "Security",
            items: [
                {
                    question: "How do I know the game is fair?",
                    answer:
                        "The game rules and hashes are registered on-chain from the start. They are immutable, so nobody can change them after publication.",
                },
                {
                    question: "Can the Creator steal the funds?",
                    answer:
                        "No. Funds are locked in a smart contract rather than a creator wallet, and distribution is handled atomically when the game resolves.",
                },
                {
                    question: "What if the Creator disappears?",
                    answer:
                        "After the grace period, players can trigger a refund action to recover their participation fees from the smart contract.",
                },
            ],
        },
        {
            title: "Judges",
            items: [
                {
                    question: "Who are the Judges?",
                    answer:
                        "Entities nominated by the Creator who audit the resolution phase and verify that the game service generated valid proofs.",
                },
                {
                    question:
                        "Why do Judges earn money for invalidating a participation?",
                    answer:
                        "Their incentive is to detect creator fraud. When they identify a faulty game service, they can receive the creator commission as a reward.",
                },
                {
                    question: "Can I be penalized as a player?",
                    answer:
                        "The system is designed to penalize the Creator or Game Service, not honest players. Judges audit the creator side, not you.",
                },
            ],
        },
        {
            title: "Economy",
            items: [
                {
                    question: "How is the winner calculated?",
                    answer:
                        "By highest time-weighted score: Score multiplied by the time weight plus remaining time. Scoring high earlier is better.",
                },
                {
                    question: "When do I receive my winnings?",
                    answer:
                        "At end game resolution. The smart contract atomically distributes the funds and sends the winner the participation pool minus creator commission and judge fees.",
                },
            ],
        },
    ];

    let showModal = false;
    let groups: FaqGroup[] = [];
    let loading = false;
    let error = false;
    let hasLoaded = false;
    let openItems = new Set<string>();

    function toggleItem(key: string) {
        const next = new Set(openItems);
        if (next.has(key)) {
            next.delete(key);
        } else {
            next.add(key);
        }
        openItems = next;
    }

    function escapeHtml(value: string) {
        return value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function formatAnswer(answer: string) {
        return escapeHtml(answer)
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/`(.+?)`/g, "<code>$1</code>")
            .replace(
                /\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>',
            );
    }

    function normalizeGroupTitle(value: string) {
        return value
            .replace(/^\d+(?:\.\d+)*\.?\s*/, "")
            .replace(/\s+FAQ$/i, "")
            .trim();
    }

    function parseFaqFromMarkdown(md: string): FaqGroup[] {
        const lines = md.split(/\r?\n/);
        const parsedGroups: FaqGroup[] = [];

        let inFaq = false;
        let currentGroupTitle = "General";
        let currentQuestion = "";
        let answerLines: string[] = [];

        const ensureGroup = (title: string) => {
            const normalized = title.trim() || "General";
            let group = parsedGroups.find(
                (entry) => entry.title.toLowerCase() === normalized.toLowerCase(),
            );
            if (!group) {
                group = { title: normalized, items: [] };
                parsedGroups.push(group);
            }
            return group;
        };

        const flushItem = () => {
            if (!currentQuestion.trim()) return;

            const answer = answerLines
                .map((line) => line.trim())
                .filter(Boolean)
                .join(" ");

            if (answer) {
                ensureGroup(currentGroupTitle).items.push({
                    question: currentQuestion.trim(),
                    answer: formatAnswer(answer),
                });
            }

            currentQuestion = "";
            answerLines = [];
        };

        for (const rawLine of lines) {
            const line = rawLine.trimEnd();
            const trimmed = line.trim();

            if (!inFaq) {
                if (
                    /^##(?:\s+\d+\.)?\s*FAQ\b/i.test(trimmed) ||
                    /^##\s+Frequently Asked Questions\b/i.test(trimmed)
                ) {
                    inFaq = true;
                }
                continue;
            }

            if (/^##\s+/.test(trimmed) || /^-----$/.test(trimmed)) {
                flushItem();
                break;
            }

            const sectionMatch = trimmed.match(/^###\s+(.+)$/);
            if (sectionMatch) {
                const heading = normalizeGroupTitle(sectionMatch[1]);

                if (heading.endsWith("?")) {
                    flushItem();
                    currentQuestion = heading;
                    continue;
                }

                flushItem();
                currentGroupTitle = heading || "General";
                ensureGroup(currentGroupTitle);
                continue;
            }

            const bulletQuestionMatch = trimmed.match(/^\*\s+\*\*(.+?)\*\*\s*$/);
            if (bulletQuestionMatch) {
                flushItem();
                currentQuestion = bulletQuestionMatch[1].trim();
                continue;
            }

            if (!currentQuestion) {
                continue;
            }

            if (!trimmed) {
                continue;
            }

            answerLines.push(trimmed.replace(/^>\s*/, ""));
        }

        flushItem();

        return parsedGroups.filter((group) => group.items.length > 0);
    }

    async function loadFaqs() {
        if (!browser || loading || hasLoaded) return;

        loading = true;
        error = false;

        try {
            const response = await fetch(README_FAQ_URL);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const markdown = await response.text();
            const parsed = parseFaqFromMarkdown(markdown);

            groups = parsed.length > 0 ? parsed : FALLBACK_GROUPS;
            error = parsed.length === 0;
        } catch {
            groups = FALLBACK_GROUPS;
            error = true;
        } finally {
            hasLoaded = true;
            loading = false;
        }
    }

    async function handleOpenModal() {
        showModal = true;
        if (!hasLoaded) {
            await loadFaqs();
        }
    }
</script>

<span
    class="faq-trigger"
    on:click={handleOpenModal}
    on:keydown={(event) => event.key === "Enter" && handleOpenModal()}
    role="button"
    tabindex="0"
>
    FAQ
</span>

<Dialog.Root bind:open={showModal}>
    <Dialog.Content class="faq-dialog w-[min(92vw,860px)] max-w-[860px] p-0">
        <div class="faq-shell">
            <Dialog.Header class="faq-header">
                <div>
                    <Dialog.Title class="faq-title">Frequently Asked Questions</Dialog.Title>
                    <p class="faq-subtitle">
                        Quick context about how Game of Prompts works, resolves and pays out.
                    </p>
                </div>
            </Dialog.Header>

            <div class="faq-body">
                {#if loading}
                    <div class="faq-container">
                        {#each [1, 2, 3] as groupIndex}
                            <div class="faq-group-skeleton" aria-hidden="true">
                                <div class="skeleton skeleton-title"></div>
                                {#each [1, 2, 3] as itemIndex}
                                    <div
                                        class="skeleton skeleton-item"
                                        data-group={groupIndex}
                                        data-item={itemIndex}
                                    ></div>
                                {/each}
                            </div>
                        {/each}
                    </div>
                {:else}
                    <div class="faq-container">
                        {#if error}
                            <p class="faq-note">
                                Showing the embedded FAQ fallback because the remote profile FAQ
                                could not be loaded or parsed.
                            </p>
                        {/if}

                        {#each groups as group, gi}
                            <section class="faq-group">
                                <h4 class="faq-group-title">
                                    <span class="faq-group-title-text">{group.title}</span>
                                </h4>

                                <div class="faq-items-card">
                                    {#each group.items as item, ii}
                                        {@const key = `${gi}-${ii}`}
                                        {@const isOpen = openItems.has(key)}

                                        <div class="faq-item" class:faq-item-open={isOpen}>
                                            <button
                                                type="button"
                                                class="faq-question"
                                                aria-expanded={isOpen}
                                                on:click={() => toggleItem(key)}
                                            >
                                                <span class="faq-question-text">{item.question}</span>
                                                <span
                                                    class="faq-toggle-icon"
                                                    class:faq-toggle-open={isOpen}
                                                    aria-hidden="true"
                                                >
                                                    +
                                                </span>
                                            </button>

                                            {#if isOpen}
                                                <div class="faq-answer" transition:slide={{ duration: 220 }}>
                                                    <p>{@html item.answer}</p>
                                                </div>
                                            {/if}
                                        </div>

                                        {#if ii < group.items.length - 1}
                                            <div class="faq-divider"></div>
                                        {/if}
                                    {/each}
                                </div>
                            </section>
                        {/each}

                        <AI_ASSISTANT prompt={FAQ_ASSISTANT_PROMPT} />
                    </div>
                {/if}
            </div>
        </div>
    </Dialog.Content>
</Dialog.Root>

<style>
    .faq-trigger {
        color: rgb(107 114 128);
        cursor: pointer;
        transition:
            color 160ms ease,
            text-decoration-color 160ms ease;
    }

    .faq-trigger:hover {
        color: #4ade80;
        text-decoration: underline;
        text-underline-offset: 0.2em;
    }

    :global(.faq-dialog) {
        overflow: hidden;
        border-color: rgba(74, 222, 128, 0.16);
        background:
            radial-gradient(circle at top left, rgba(74, 222, 128, 0.08), transparent 35%),
            hsl(var(--background));
        box-shadow:
            0 22px 80px rgba(0, 0, 0, 0.45),
            inset 0 1px 0 rgba(255, 255, 255, 0.04);
    }

    .faq-shell {
        display: flex;
        max-height: min(85vh, 860px);
        flex-direction: column;
    }

    :global(.faq-header) {
        margin: 0;
        gap: 0.5rem;
        border-bottom: 1px solid rgba(74, 222, 128, 0.08);
        padding: 1.5rem 1.5rem 1rem;
        text-align: left;
    }

    :global(.faq-title) {
        margin-right: 2rem;
        font-size: 1.35rem;
        line-height: 1.2;
    }

    .faq-subtitle {
        margin: 0.25rem 0 0;
        color: hsl(var(--muted-foreground));
        font-size: 0.92rem;
        line-height: 1.6;
    }

    .faq-body {
        overflow-y: auto;
        padding: 1.25rem 1.5rem 1.5rem;
    }

    .faq-container {
        display: flex;
        flex-direction: column;
        gap: 2rem;
    }

    .faq-note {
        margin: 0;
        border: 1px solid rgba(74, 222, 128, 0.12);
        border-radius: 0.9rem;
        background: rgba(74, 222, 128, 0.04);
        color: hsl(var(--muted-foreground));
        padding: 0.8rem 1rem;
        font-size: 0.82rem;
        line-height: 1.55;
    }

    .faq-group-skeleton {
        display: flex;
        flex-direction: column;
        gap: 0.55rem;
    }

    .skeleton {
        border-radius: 0.75rem;
        background: linear-gradient(
            90deg,
            rgba(74, 222, 128, 0.05) 25%,
            rgba(74, 222, 128, 0.12) 50%,
            rgba(74, 222, 128, 0.05) 75%
        );
        background-size: 200% 100%;
        animation: shimmer 1.5s infinite;
    }

    .skeleton-title {
        height: 1.25rem;
        margin-bottom: 0.85rem;
        width: 7rem;
    }

    .skeleton-item {
        height: 3.35rem;
        width: 100%;
    }

    .faq-group {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
    }

    .faq-group-title {
        margin: 0;
        color: #4ade80;
        font-family: var(--font-mono);
        font-size: 0.8rem;
        font-weight: 600;
        letter-spacing: 0.16em;
        padding-left: 0.2rem;
        text-transform: uppercase;
    }

    .faq-group-title-text {
        position: relative;
        display: inline-block;
        padding-bottom: 0.3rem;
    }

    .faq-group-title-text::after {
        content: "";
        position: absolute;
        left: 0;
        bottom: 0;
        height: 2px;
        width: 100%;
        border-radius: 999px;
        background: linear-gradient(90deg, #4ade80, transparent);
        opacity: 0.6;
    }

    .faq-items-card {
        overflow: hidden;
        border: 1px solid rgba(74, 222, 128, 0.1);
        border-radius: 1rem;
        background: hsl(var(--card) / 0.72);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12);
    }

    .faq-item {
        transition: background 160ms ease;
    }

    .faq-item-open {
        background: rgba(74, 222, 128, 0.035);
    }

    .faq-divider {
        height: 1px;
        margin: 0 1.25rem;
        background: rgba(74, 222, 128, 0.08);
    }

    .faq-question {
        display: flex;
        width: 100%;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        border: 0;
        background: transparent;
        cursor: pointer;
        padding: 1rem 1.25rem;
        text-align: left;
    }

    .faq-question-text {
        color: hsl(var(--foreground));
        font-size: 0.98rem;
        font-weight: 600;
        line-height: 1.5;
        transition: color 160ms ease;
    }

    .faq-question:hover .faq-question-text {
        color: #4ade80;
    }

    .faq-toggle-icon {
        display: inline-flex;
        height: 1.8rem;
        width: 1.8rem;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border-radius: 0.65rem;
        background: rgba(74, 222, 128, 0.1);
        color: #4ade80;
        font-size: 1.1rem;
        line-height: 1;
        transition:
            transform 200ms ease,
            background 160ms ease;
    }

    .faq-toggle-open {
        transform: rotate(45deg);
        background: rgba(74, 222, 128, 0.18);
    }

    .faq-answer {
        padding: 0 1.25rem 1.15rem;
    }

    .faq-answer p {
        margin: 0;
        color: hsl(var(--muted-foreground));
        font-size: 0.92rem;
        line-height: 1.75;
    }

    .faq-answer :global(a) {
        color: #4ade80;
        text-decoration: underline;
        text-underline-offset: 0.14em;
    }

    .faq-answer :global(code) {
        border-radius: 0.35rem;
        background: rgba(74, 222, 128, 0.1);
        padding: 0.12rem 0.35rem;
        font-family: var(--font-mono);
        font-size: 0.85em;
    }

    .faq-answer :global(strong) {
        color: hsl(var(--foreground));
        font-weight: 600;
    }

    @keyframes shimmer {
        0% {
            background-position: 200% 0;
        }

        100% {
            background-position: -200% 0;
        }
    }

    :global(:root:not(.dark) .faq-dialog) {
        background:
            radial-gradient(circle at top left, rgba(21, 128, 61, 0.08), transparent 35%),
            #ffffff;
    }

    :global(:root:not(.dark)) .faq-trigger:hover,
    :global(:root:not(.dark)) .faq-question:hover .faq-question-text,
    :global(:root:not(.dark)) .faq-answer :global(a),
    :global(:root:not(.dark)) .faq-group-title {
        color: #15803d;
    }

    :global(:root:not(.dark)) .faq-toggle-icon {
        background: rgba(21, 128, 61, 0.1);
        color: #15803d;
    }

    :global(:root:not(.dark)) .faq-toggle-open {
        background: rgba(21, 128, 61, 0.16);
    }

    @media (max-width: 640px) {
        :global(.faq-header) {
            padding: 1.25rem 1.1rem 0.9rem;
        }

        .faq-body {
            padding: 1rem 1.1rem 1.1rem;
        }

        .faq-question {
            padding: 0.95rem 1rem;
        }

        .faq-answer {
            padding: 0 1rem 1rem;
        }
    }
</style>
