<script lang="ts">
    import { onMount } from "svelte";
    import { get } from "svelte/store";
    import { game_detail, games, isLoadingGames } from "$lib/common/store";
    import { GameState, type AnyGame as Game } from "$lib/common/game";
    import { fetchGoPGames } from "$lib/ergo/fetch";
    import { explorer_uri, isDevMode } from "$lib/ergo/envs";
    import { DEV_COMPETITIONS } from "$lib/dev/dev-competitions";
    import { fetchFileSourcesByHash } from "source-application";
    import {
        WalletButton,
        walletBalance,
        walletConnected,
    } from "wallet-svelte-component";
    import {
        ArrowRight,
        Loader2,
        Sparkles,
        Trophy,
        Wallet,
    } from "lucide-svelte";

    let isBootstrapping = true;
    let trophyGames: Game[] = [];
    let hasWalletContext = false;
    let resolvedImages = new Map<string, string>();
    const imageLoadsInFlight = new Set<string>();
    const DEV_TROPHY_GAME_IDS = DEV_COMPETITIONS.filter(
        (competition) =>
            competition.key === "finalized" ||
            competition.key.startsWith("finalized_"),
    ).map((competition) => competition.gameId);
    const DEV_TROPHY_BALANCE = 1n;

    onMount(async () => {
        try {
            await fetchGoPGames();
        } finally {
            isBootstrapping = false;
        }
    });

    function sortGamesByNewest(left: Game, right: Game) {
        return (right.box?.creationHeight ?? 0) - (left.box?.creationHeight ?? 0);
    }

    function getTrophyGames(
        allGames: Map<string, Game>,
        walletTokens: { tokenId: string; amount: bigint }[],
    ) {
        const ownedTokenIds = new Set(
            walletTokens
                .filter((token) => token.amount > 0n)
                .map((token) => token.tokenId),
        );

        return Array.from(allGames.values())
            .filter(
                (game) =>
                    ownedTokenIds.has(game.gameId) &&
                    game.status === GameState.Finalized,
            )
            .sort(sortGamesByNewest);
    }

    $: hasWalletContext = $walletConnected || $isDevMode;

    $: trophyGames = getTrophyGames(
        $games.data,
        ([
            ...(($walletBalance?.tokens ?? []) as {
                tokenId: string;
                amount: bigint;
            }[]),
            ...($isDevMode
                ? DEV_TROPHY_GAME_IDS.map((tokenId) => ({
                      tokenId,
                      amount: DEV_TROPHY_BALANCE,
                  }))
                : []),
        ] as { tokenId: string; amount: bigint }[]),
    );

    async function resolveGameImage(game: Game) {
        if (!game.content.image || resolvedImages.has(game.gameId)) {
            return;
        }

        imageLoadsInFlight.add(game.gameId);
        try {
            const sources = await fetchFileSourcesByHash(
                game.content.image,
                get(explorer_uri),
            );
            if (sources.length > 0) {
                resolvedImages = new Map(resolvedImages).set(
                    game.gameId,
                    sources[0].url,
                );
            }
        } catch (error) {
            console.warn(
                `Unable to resolve trophy image for game ${game.gameId}:`,
                error,
            );
        } finally {
            imageLoadsInFlight.delete(game.gameId);
        }
    }

    $: if (trophyGames.length > 0) {
        for (const trophyGame of trophyGames) {
            if (
                trophyGame.content.image &&
                !resolvedImages.has(trophyGame.gameId) &&
                !imageLoadsInFlight.has(trophyGame.gameId)
            ) {
                void resolveGameImage(trophyGame);
            }
        }
    }

    function getCardImage(game: Game) {
        return resolvedImages.get(game.gameId) ?? game.content.imageURL ?? "";
    }

    function openGame(game: Game) {
        game_detail.set(game);
    }

    function shortenTokenId(value: string) {
        if (value.length <= 16) return value;
        return `${value.slice(0, 8)}...${value.slice(-6)}`;
    }
</script>

<div class="trophies-shell">
    <section class="hero-section gop-game-card">
        <h2
            class="text-4xl font-extrabold tracking-tight lg:text-5xl mb-3 mt-1 gop-gradient-text inline-block"
            style="font-family: var(--font-heading);"
        >
            Your Trophies
        </h2>
        <p class="subtitle">
            NFTs from competitions you won and currently keep in this wallet.
        </p>
        {#if $isDevMode}
            <p class="dev-note">
                Dev mode preview: showing mock trophy ownership to simulate a logged wallet.
            </p>
        {/if}
        <div class="counts-row">
            <div class="badge">
                <span>Trophies</span>
                <strong>{#if !hasWalletContext}-{:else}{trophyGames.length}{/if}</strong>
            </div>
        </div>
    </section>

    {#if !hasWalletContext}
        <section class="empty-panel gop-game-card">
            <div class="empty-icon"><Wallet class="h-10 w-10" /></div>
            <h3>Connect your wallet to see your trophies</h3>
            <p>This tab shows the competition NFTs currently in your wallet.</p>
            <div class="wallet-cta"><WalletButton /></div>
        </section>
    {:else if isBootstrapping || $isLoadingGames}
        <section class="empty-panel gop-game-card loading">
            <Loader2 class="h-10 w-10 animate-spin text-primary" />
            <h3>Loading your trophies</h3>
            <p>Checking which competition NFTs are in your wallet.</p>
        </section>
    {:else if trophyGames.length === 0}
        <section class="empty-panel gop-game-card">
            <div class="empty-icon"><Sparkles class="h-10 w-10" /></div>
            <h3>No trophies in this wallet yet</h3>
            <p>When you win a competition and keep its NFT, it appears here automatically.</p>
        </section>
    {:else}
        <section class="trophies-grid" aria-label="Won competition NFTs">
            {#each trophyGames as game (game.gameId)}
                <button
                    type="button"
                    class="trophy-card gop-game-card"
                    on:click={() => openGame(game)}
                >
                    <div class="trophy-media">
                        {#if getCardImage(game)}
                            <img
                                src={getCardImage(game)}
                                alt={game.content.title}
                                class="trophy-image"
                                loading="lazy"
                            />
                        {:else}
                            <div class="trophy-fallback">
                                {game.gameId.slice(0, 4)}
                            </div>
                        {/if}
                        <div class="trophy-pill">
                            <Trophy class="h-3.5 w-3.5" />
                            Trophy NFT
                        </div>
                    </div>

                    <div class="trophy-body">
                        <div class="trophy-meta">
                            <span>Won competition</span>
                            <ArrowRight class="h-4 w-4" />
                        </div>
                        <h3>{game.content.title || "Untitled competition"}</h3>
                        <p>
                            {game.content.description ||
                                "Open this trophy to revisit the competition details."}
                        </p>
                        <div class="trophy-footer">
                            <span class="token-label">NFT</span>
                            <code>{shortenTokenId(game.gameId)}</code>
                        </div>
                    </div>
                </button>
            {/each}
        </section>
    {/if}
</div>

<style>
    .trophies-shell {
        width: min(1600px, 100%);
        margin: 0 auto;
        padding: 1rem 1rem 3rem;
    }

    .hero-section {
        padding: 1.1rem 1.2rem;
        margin-bottom: 1.2rem;
    }

    .subtitle {
        margin: 0;
        color: hsl(var(--muted-foreground));
        max-width: 66ch;
    }

    .counts-row {
        margin-top: 0.85rem;
        display: flex;
        gap: 0.75rem;
    }

    .dev-note {
        margin: 0.6rem 0 0;
        color: #86efac;
        font-family: var(--font-mono);
        font-size: 0.8rem;
    }

    .badge {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-family: var(--font-mono);
        font-size: 0.82rem;
        color: hsl(var(--muted-foreground));
        padding: 0.35rem 0.7rem;
        border-radius: 999px;
        border: 1px solid rgba(74, 222, 128, 0.2);
        background: rgba(74, 222, 128, 0.08);
    }

    .badge strong {
        color: #4ade80;
        font-size: 0.9rem;
    }

    .empty-panel {
        text-align: center;
        display: grid;
        justify-items: center;
        gap: 0.8rem;
        padding: 2.5rem 1.25rem;
        margin-bottom: 0.4rem;
    }

    .empty-panel h3 {
        margin: 0;
        font-size: 1.35rem;
    }

    .empty-panel p {
        margin: 0;
        max-width: 46rem;
        color: hsl(var(--muted-foreground));
    }

    .empty-panel.loading {
        min-height: 16rem;
        align-content: center;
    }

    .empty-icon {
        display: grid;
        place-items: center;
        width: 4.2rem;
        height: 4.2rem;
        border-radius: 999px;
        color: #4ade80;
        background: rgba(74, 222, 128, 0.1);
        border: 1px solid rgba(74, 222, 128, 0.16);
    }

    .wallet-cta {
        margin-top: 0.3rem;
    }

    .trophies-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
        gap: 1.1rem;
    }

    .trophy-card {
        display: flex;
        flex-direction: column;
        text-align: left;
        border-radius: 1rem;
        overflow: hidden;
        transition: transform 180ms ease;
    }

    .trophy-card:hover {
        transform: translateY(-2px);
    }

    .trophy-media {
        position: relative;
        aspect-ratio: 1 / 1;
        background: linear-gradient(135deg, rgba(22, 22, 22, 0.86), rgba(10, 10, 10, 0.94));
    }

    .trophy-image,
    .trophy-fallback {
        width: 100%;
        height: 100%;
    }

    .trophy-image {
        display: block;
        object-fit: cover;
    }

    .trophy-fallback {
        display: grid;
        place-items: center;
        color: rgba(255, 255, 255, 0.24);
        font-size: 3rem;
        font-weight: 800;
        letter-spacing: 0.08em;
    }

    .trophy-pill {
        position: absolute;
        top: 0.8rem;
        left: 0.8rem;
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.35rem 0.65rem;
        border-radius: 999px;
        background: rgba(5, 5, 5, 0.66);
        border: 1px solid rgba(74, 222, 128, 0.18);
        color: #86efac;
        font-size: 0.72rem;
        font-family: var(--font-mono);
        text-transform: uppercase;
        letter-spacing: 0.05em;
    }

    .trophy-body {
        display: grid;
        gap: 0.8rem;
        padding: 0.95rem 0.95rem 1.05rem;
    }

    .trophy-meta {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        color: hsl(var(--muted-foreground));
        font-size: 0.76rem;
        font-family: var(--font-mono);
        text-transform: uppercase;
        letter-spacing: 0.04em;
    }

    .trophy-body h3 {
        margin: 0;
        font-size: 1.1rem;
        line-height: 1.2;
    }

    .trophy-body p {
        margin: 0;
        color: hsl(var(--muted-foreground));
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
    }

    .trophy-footer {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
        padding-top: 0.25rem;
        border-top: 1px solid hsl(var(--border));
    }

    .token-label {
        flex-shrink: 0;
        color: #4ade80;
        font-size: 0.72rem;
        font-family: var(--font-mono);
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .trophy-footer code {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: hsl(var(--foreground));
        font-size: 0.82rem;
    }

    @media (max-width: 640px) {
        .trophies-shell {
            padding: 0.8rem 0.85rem 2.7rem;
        }

        .hero-section {
            padding: 1rem;
        }
    }
</style>
