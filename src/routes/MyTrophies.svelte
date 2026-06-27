<script lang="ts">
    import { onMount } from "svelte";
    import type { AnyGame as Game } from "$lib/common/game";
    import { games, isLoadingGames } from "$lib/common/store";
    import { isDevMode } from "$lib/ergo/envs";
    import { WalletButton, walletBalance, walletConnected } from "wallet-svelte-component";
    import { Loader2, Sparkles, Wallet } from "lucide-svelte";
    import TrophyList from "./TrophyList.svelte";
    import {
        ensureTrophyGamesLoaded,
        getTrophyGamesForWallet,
        type WalletTokenBalance,
    } from "$lib/trophies";
    import { DEV_COMPETITIONS } from "$lib/dev/dev-competitions";

    let isBootstrapping = true;
    let trophyGames: Game[] = [];
    let hasWalletContext = false;

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

    $: hasWalletContext = $walletConnected || $isDevMode;

    $: trophyGames = getTrophyGamesForWallet(
        $games.data,
        [
            ...(($walletBalance?.tokens ?? []) as WalletTokenBalance[]),
            ...($isDevMode
                ? DEV_TROPHY_GAME_IDS.map((tokenId) => ({
                      tokenId,
                      amount: DEV_TROPHY_BALANCE,
                  }))
                : []),
        ] as WalletTokenBalance[],
    );
</script>

<div class="trophies-shell">
    <section class="hero-section gop-game-card">
        <h2
            class="text-4xl font-extrabold tracking-tight lg:text-5xl mb-3 mt-1 gop-gradient-text inline-block"
            style="font-family: var(--font-heading);"
        >
            My Trophies
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
        <TrophyList games={trophyGames} ariaLabel="My won competition NFTs" />
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

    @media (max-width: 640px) {
        .trophies-shell {
            padding: 0.8rem 0.85rem 2.7rem;
        }

        .hero-section {
            padding: 1rem;
        }
    }
</style>
