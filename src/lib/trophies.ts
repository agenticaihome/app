import { get, writable } from "svelte/store";
import { fetchFileSourcesByHash } from "source-application";
import { ErgoAddress, Network, type Amount, type Box } from "@fleet-sdk/core";
import { game_detail, games } from "$lib/common/store";
import { GameState, type AnyGame as Game } from "$lib/common/game";
import { explorer_uri } from "$lib/ergo/envs";
import { fetchGoPGames } from "$lib/ergo/fetch";

export type WalletTokenBalance = {
    tokenId: string;
    amount: bigint;
};

export type ThroneEntry = {
    address: string;
    trophyGames: Game[];
    latestCreationHeight: number;
};

export const resolvedTrophyImages = writable(new Map<string, string>());

const imageLoadsInFlight = new Set<string>();
const holderLoadsInFlight = new Map<string, Promise<string | null>>();

export function sortGamesByNewest(left: Game, right: Game) {
    return (right.box?.creationHeight ?? 0) - (left.box?.creationHeight ?? 0);
}

export function getFinalizedTrophyGames(allGames: Map<string, Game>) {
    return Array.from(allGames.values())
        .filter((game) => game.status === GameState.Finalized)
        .sort(sortGamesByNewest);
}

export function getTrophyGamesForWallet(
    allGames: Map<string, Game>,
    walletTokens: WalletTokenBalance[],
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

export async function ensureTrophyGamesLoaded() {
    if (get(games).data.size > 0) {
        return;
    }

    await fetchGoPGames();
}

export async function ensureTrophyImage(game: Game) {
    if (!game.content.image) {
        return;
    }

    const currentImages = get(resolvedTrophyImages);
    if (currentImages.has(game.gameId) || imageLoadsInFlight.has(game.gameId)) {
        return;
    }

    imageLoadsInFlight.add(game.gameId);

    try {
        const sources = await fetchFileSourcesByHash(
            game.content.image,
            get(explorer_uri),
        );
        if (sources.length > 0) {
            resolvedTrophyImages.update((images) => {
                const next = new Map(images);
                const resolvedUrl = sources[0].source.urlLink;
                if (resolvedUrl) {
                    next.set(game.gameId, resolvedUrl);
                }
                return next;
            });
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

export function getTrophyCardImage(
    game: Game,
    images: Map<string, string>,
) {
    return images.get(game.gameId) ?? game.content.imageURL ?? "";
}

export function openTrophyGame(game: Game) {
    game_detail.set(game);
}

export function shortenHash(value: string, start: number = 8, end: number = 6) {
    if (value.length <= start + end + 3) {
        return value;
    }

    return `${value.slice(0, start)}...${value.slice(-end)}`;
}

function toWalletAddress(box: Box<Amount> | null | undefined) {
    if (!box) {
        return null;
    }

    try {
        return ErgoAddress.fromErgoTree(box.ergoTree, Network.Mainnet).toString();
    } catch (error) {
        console.warn("Unable to derive wallet address from trophy holder box:", error);
        return null;
    }
}

async function fetchCurrentHolderBox(gameId: string): Promise<Box<Amount> | null> {
    const url = `${get(explorer_uri)}/api/v1/boxes/unspent/byTokenId/${gameId}?limit=1`;
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`API response: ${response.status}`);
    }

    const data = await response.json();
    return data.items?.[0] ?? null;
}

export async function fetchCurrentHolderAddress(game: Game) {
    const existingLoad = holderLoadsInFlight.get(game.gameId);
    if (existingLoad) {
        return existingLoad;
    }

    const load = (async () => {
        try {
            const currentBox = await fetchCurrentHolderBox(game.gameId);
            return toWalletAddress(currentBox) ?? toWalletAddress(game.box);
        } catch (error) {
            console.warn(
                `Unable to resolve current holder for trophy ${game.gameId}:`,
                error,
            );
            return toWalletAddress(game.box);
        } finally {
            holderLoadsInFlight.delete(game.gameId);
        }
    })();

    holderLoadsInFlight.set(game.gameId, load);
    return load;
}

export async function buildThroneEntries(finalizedGames: Game[]) {
    const grouped = new Map<string, ThroneEntry>();

    for (const game of finalizedGames) {
        const holderAddress = await fetchCurrentHolderAddress(game);
        if (!holderAddress) {
            continue;
        }

        const currentEntry = grouped.get(holderAddress);
        if (currentEntry) {
            currentEntry.trophyGames.push(game);
            currentEntry.latestCreationHeight = Math.max(
                currentEntry.latestCreationHeight,
                game.box?.creationHeight ?? 0,
            );
        } else {
            grouped.set(holderAddress, {
                address: holderAddress,
                trophyGames: [game],
                latestCreationHeight: game.box?.creationHeight ?? 0,
            });
        }
    }

    return Array.from(grouped.values())
        .map((entry) => ({
            ...entry,
            trophyGames: [...entry.trophyGames].sort(sortGamesByNewest),
        }))
        .sort((left, right) => {
            if (right.trophyGames.length !== left.trophyGames.length) {
                return right.trophyGames.length - left.trophyGames.length;
            }

            return right.latestCreationHeight - left.latestCreationHeight;
        });
}
