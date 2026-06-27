<script lang="ts">
    import { onMount } from "svelte";
    import { Crown, Info, Loader2, Sparkles, Trophy } from "lucide-svelte";
    import { games, isLoadingGames } from "$lib/common/store";
    import { isDevMode } from "$lib/ergo/envs";
    import { DEV_COMPETITIONS } from "$lib/dev/dev-competitions";
    import { walletAddress, walletConnected } from "wallet-svelte-component";
    import TrophyList from "./TrophyList.svelte";
    import type { AnyGame as Game } from "$lib/common/game";
    import {
        buildThroneEntries,
        ensureTrophyGamesLoaded,
        getFinalizedTrophyGames,
        getTrophyGamesForWallet,
        shortenHash,
        type ThroneEntry,
        type WalletTokenBalance,
    } from "$lib/trophies";

    let isBootstrapping = true;
    let isResolvingThrone = false;
    let throneEntries: ThroneEntry[] = [];
    let finalizedGamesCount = 0;
    let throneWinner: ThroneEntry | null = null;
    let isCurrentUserOnThrone = false;
    let devModeThroneWinner: ThroneEntry | null = null;
    let devModeTrophyGames: Game[] = [];

    const DEV_TROPHY_GAME_IDS = DEV_COMPETITIONS.filter(
        (competition) =>
            competition.key === "finalized" ||
            competition.key.startsWith("finalized_"),
    ).map((competition) => competition.gameId);
    const DEV_TROPHY_BALANCE = 1n;

    onMount(async () => {
        try {
            await ensureTrophyGamesLoaded();
        } finally {
            isBootstrapping = false;
        }
    });

    $: finalizedGamesCount = getFinalizedTrophyGames($games.data).length;
    $: devModeTrophyGames = getTrophyGamesForWallet(
        $games.data,
        DEV_TROPHY_GAME_IDS.map((tokenId) => ({
            tokenId,
            amount: DEV_TROPHY_BALANCE,
        })) as WalletTokenBalance[],
    );

    $: devModeThroneWinner = $isDevMode
        ? {
              address: $walletAddress || "Your wallet (dev mode)",
              trophyGames: devModeTrophyGames,
              latestCreationHeight: Math.max(
                  0,
                  ...devModeTrophyGames.map((game) => game.box?.creationHeight ?? 0),
              ),
          }
        : null;

    $: if (!isBootstrapping && !$isLoadingGames) {
        void refreshThrone(getFinalizedTrophyGames($games.data));
    }

    async function refreshThrone(finalizedGames = getFinalizedTrophyGames($games.data)) {
        if (isResolvingThrone) {
            return;
        }

        if (finalizedGames.length === 0) {
            throneEntries = [];
            return;
        }

        isResolvingThrone = true;
        try {
            throneEntries = await buildThroneEntries(finalizedGames);
        } finally {
            isResolvingThrone = false;
        }
    }

    $: throneWinner = $isDevMode
        ? devModeThroneWinner
        : (throneEntries[0] ?? null);
    $: isCurrentUserOnThrone =
        !!throneWinner &&
        (($walletConnected &&
            !!$walletAddress &&
            throneWinner.address === $walletAddress) ||
            $isDevMode);
</script>

<div class="throne-shell">
    <section class="throne-tip gop-game-card">
        <div class="tip-icon"><Info class="h-5 w-5" /></div>
        <p>The Throne belongs to the wallet currently holding the most GoP competition trophies.</p>
    </section>

    {#if isBootstrapping || $isLoadingGames || isResolvingThrone}
        <section class="throne-hero gop-game-card loading">
            <div class="hero-crown"><Loader2 class="h-12 w-12 animate-spin" /></div>
            <div class="hero-copy">
                <span class="eyebrow">Throne</span>
                <h2>Resolving the current ruler</h2>
                <p>Scanning finalized competition NFTs to discover which wallet holds the crown.</p>
            </div>
        </section>
    {:else if finalizedGamesCount === 0}
        <section class="throne-hero gop-game-card empty">
            <div class="hero-crown"><Sparkles class="h-12 w-12" /></div>
            <div class="hero-copy">
                <span class="eyebrow">Throne</span>
                <h2>No ruler yet</h2>
                <p>The throne will awaken as soon as finalized GoP competition trophies begin to circulate.</p>
            </div>
        </section>
    {:else if !throneWinner}
        <section class="throne-hero gop-game-card empty">
            <div class="hero-crown"><Trophy class="h-12 w-12" /></div>
            <div class="hero-copy">
                <span class="eyebrow">Throne</span>
                <h2>The throne is hidden for now</h2>
                <p>Finalized trophies exist, but the current holder could not be resolved from the available boxes.</p>
            </div>
        </section>
    {:else}
        <section class="throne-hero gop-game-card">
            <div class="hero-backdrop"></div>
            <div class="hero-crown"><Crown class="h-12 w-12" /></div>
            <div class="hero-copy">
                <div class="hero-topline">
                    <span class="eyebrow">Current Throne</span>
                    {#if isCurrentUserOnThrone}
                        <span class="me-badge">It's you</span>
                    {/if}
                </div>
                <h2>{shortenHash(throneWinner.address, 16, 12)}</h2>
                <p class="wallet-full">{throneWinner.address}</p>
                <p class="hero-description">
                    This wallet currently holds the largest collection of GoP competition trophies on-chain.
                </p>
                {#if $isDevMode}
                    <p class="dev-note">
                        Dev mode preview: the throne is pinned to your current user for local testing.
                    </p>
                {/if}
                <div class="hero-stats">
                    <div class="stat-pill">
                        <Trophy class="h-4 w-4" />
                        <span>{throneWinner.trophyGames.length} trophies</span>
                    </div>
                    <div class="stat-pill subtle">
                        <span>{#if isCurrentUserOnThrone}You are sitting on the throne{:else}The crown is earned by possession{/if}</span>
                    </div>
                </div>
            </div>
        </section>

        <section class="throne-gallery">
            <div class="gallery-head">
                <h3>Trophies in the Throne</h3>
                <p>The current ruler’s trophy vault, ordered from newest to oldest.</p>
            </div>

            <TrophyList
                games={throneWinner.trophyGames}
                ariaLabel="Throne trophy collection"
                trophyLabel="Throne Trophy"
                metaLabel="Held on the throne"
            />
        </section>
    {/if}
</div>

<style>
    .throne-shell {
        width: min(1680px, 100%);
        margin: 0 auto;
        padding: 1rem 1rem 3rem;
        display: grid;
        gap: 1.2rem;
    }

    .throne-tip {
        display: flex;
        align-items: center;
        gap: 0.85rem;
        padding: 0.95rem 1rem;
        border: 1px solid rgba(245, 158, 11, 0.22);
        background:
            linear-gradient(120deg, rgba(245, 158, 11, 0.12), rgba(250, 204, 21, 0.05)),
            rgba(10, 10, 10, 0.18);
    }

    .tip-icon {
        display: grid;
        place-items: center;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 999px;
        flex-shrink: 0;
        color: #fbbf24;
        background: rgba(251, 191, 36, 0.14);
        border: 1px solid rgba(251, 191, 36, 0.2);
    }

    .throne-tip p {
        margin: 0;
        color: hsl(var(--foreground));
        line-height: 1.5;
    }

    .throne-hero {
        position: relative;
        overflow: hidden;
        min-height: 24rem;
        padding: 1.5rem;
        display: grid;
        align-items: end;
        grid-template-columns: 100px minmax(0, 1fr);
        gap: 1.4rem;
        background: var(--throne-bg, #ffffff);
        border: 1px solid rgba(245, 158, 11, 0.14);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
    }

    .throne-hero.loading,
    .throne-hero.empty {
        min-height: 18rem;
        align-items: center;
    }

    .hero-backdrop {
        position: absolute;
        inset: auto -8% -28% auto;
        width: 28rem;
        height: 28rem;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(250, 204, 21, 0.17), transparent 62%);
        pointer-events: none;
    }

    .hero-crown {
        position: relative;
        display: grid;
        place-items: center;
        width: 6rem;
        height: 6rem;
        align-self: start;
        border-radius: 1.5rem;
        color: #facc15;
        background: linear-gradient(160deg, rgba(250, 204, 21, 0.16), rgba(245, 158, 11, 0.08));
        border: 1px solid rgba(250, 204, 21, 0.25);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    .hero-copy {
        position: relative;
        display: grid;
        gap: 0.85rem;
        min-width: 0;
    }

    .hero-topline {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.7rem;
    }

    .eyebrow {
        font-family: var(--font-mono);
        font-size: 0.82rem;
        text-transform: uppercase;
        letter-spacing: 0.12em;
        color: #fde68a;
    }

    .me-badge,
    .stat-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.45rem;
        padding: 0.4rem 0.8rem;
        border-radius: 999px;
        font-family: var(--font-mono);
        font-size: 0.78rem;
    }

    .me-badge {
        color: #1a1204;
        background: linear-gradient(120deg, #facc15, #f59e0b);
        box-shadow: 0 10px 24px rgba(245, 158, 11, 0.2);
    }

    .hero-copy h2 {
        margin: 0;
        font-size: clamp(2.8rem, 5vw, 5.8rem);
        line-height: 0.96;
        letter-spacing: -0.04em;
        word-break: break-word;
    }

    .wallet-full {
        margin: 0;
        max-width: 100%;
        overflow-wrap: anywhere;
        color: rgba(255, 247, 214, 0.8);
        font-family: var(--font-mono);
        font-size: 0.92rem;
    }

    .hero-description {
        margin: 0;
        max-width: 58rem;
        font-size: 1.03rem;
        line-height: 1.6;
        color: rgba(255, 248, 220, 0.88);
    }

    .hero-stats {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        padding-top: 0.25rem;
    }

    .dev-note {
        margin: 0;
        color: #fde68a;
        font-family: var(--font-mono);
        font-size: 0.8rem;
    }

    .stat-pill {
        color: #fff1b8;
        border: 1px solid rgba(250, 204, 21, 0.18);
        background: rgba(250, 204, 21, 0.08);
    }

    .stat-pill.subtle {
        color: hsl(var(--muted-foreground));
        background: rgba(255, 255, 255, 0.03);
        border-color: rgba(255, 255, 255, 0.08);
    }

    :global(:root) {
        --throne-bg: #ffffff;
    }

    :global(.dark) {
        --throne-bg:
            radial-gradient(circle at top left, rgba(250, 204, 21, 0.22), transparent 28%),
            radial-gradient(circle at top right, rgba(245, 158, 11, 0.16), transparent 30%),
            linear-gradient(135deg, rgba(18, 18, 18, 0.96), rgba(9, 9, 9, 0.98));
    }

    :global(.dark) .throne-hero {
        border: 1px solid rgba(245, 158, 11, 0.14);
    }

    :global(.dark) .hero-copy h2 {
        color: #fff7d6;
        text-shadow: 0 0 40px rgba(250, 204, 21, 0.1);
    }

    :global(:root:not(.dark)) .throne-hero {
        background: #ffffff;
        border: 1px solid rgba(0, 0, 0, 0.08);
    }

    :global(:root:not(.dark)) .hero-copy h2 {
        color: #111827;
        text-shadow: none;
    }

    :global(:root:not(.dark)) .wallet-full {
        color: rgba(0, 0, 0, 0.7);
    }

    :global(:root:not(.dark)) .hero-description {
        color: rgba(0, 0, 0, 0.8);
    }

    :global(:root:not(.dark)) .eyebrow {
        color: #b45309;
    }

    :global(:root:not(.dark)) .stat-pill {
        color: #92400e;
        background: rgba(245, 158, 11, 0.12);
        border: 1px solid rgba(245, 158, 11, 0.25);
    }

    :global(:root:not(.dark)) .stat-pill.subtle {
        color: rgba(0, 0, 0, 0.6);
        background: rgba(0, 0, 0, 0.04);
        border-color: rgba(0, 0, 0, 0.08);
    }

    .gallery-head {
        margin-bottom: 1rem;
        display: grid;
        gap: 0.3rem;
    }

    .gallery-head h3 {
        margin: 0;
        font-size: 1.5rem;
    }

    .gallery-head p {
        margin: 0;
        color: hsl(var(--muted-foreground));
    }

    @media (max-width: 900px) {
        .throne-hero {
            grid-template-columns: 1fr;
            min-height: 0;
        }

        .hero-crown {
            width: 5rem;
            height: 5rem;
        }
    }

    @media (max-width: 640px) {
        .throne-shell {
            padding: 0.8rem 0.85rem 2.7rem;
        }

        .throne-tip,
        .throne-hero {
            padding: 1rem;
        }

        .hero-copy h2 {
            font-size: clamp(2.2rem, 12vw, 3.4rem);
        }
    }
</style>
