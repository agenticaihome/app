<script lang="ts">
    import { Trophy, ArrowRight } from "lucide-svelte";
    import { hoverCorners } from "$lib/hoverCorners";
    import {
        ensureTrophyImage,
        getTrophyCardImage,
        openTrophyGame,
        resolvedTrophyImages,
        shortenHash,
    } from "$lib/trophies";
    import type { AnyGame as Game } from "$lib/common/game";

    export let games: Game[] = [];
    export let ariaLabel = "Trophy collection";
    export let trophyLabel = "Trophy NFT";
    export let metaLabel = "Won competition";
    export let emptyDescription =
        "Open this trophy to revisit the competition details.";

    $: if (games.length > 0) {
        for (const game of games) {
            if (game.content.image) {
                void ensureTrophyImage(game);
            }
        }
    }
</script>

<section class="trophies-grid" aria-label={ariaLabel}>
    {#each games as game (game.gameId)}
        <button
            type="button"
            class="trophy-card gop-game-card"
            use:hoverCorners
            on:click={() => openTrophyGame(game)}
        >
            <div class="trophy-media">
                {#if getTrophyCardImage(game, $resolvedTrophyImages)}
                    <img
                        src={getTrophyCardImage(game, $resolvedTrophyImages)}
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
                    {trophyLabel}
                </div>
            </div>

            <div class="trophy-body">
                <div class="trophy-meta">
                    <span>{metaLabel}</span>
                    <ArrowRight class="h-4 w-4" />
                </div>
                <h3>{game.content.title || "Untitled competition"}</h3>
                <p>{game.content.description || emptyDescription}</p>
                <div class="trophy-footer">
                    <span class="token-label">NFT</span>
                    <code>{shortenHash(game.gameId)}</code>
                </div>
            </div>
        </button>
    {/each}
</section>

<style>
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
        line-clamp: 3;
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
</style>
