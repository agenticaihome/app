<script lang="ts">
    import {
        type AnyGame,
        GameState,
        resolve_participation_commitment,
    } from "$lib/common/game";
    import {
        type GamePhaseSnapshot,
        deriveGamePhaseSnapshot,
    } from "$lib/common/game-phase";
    import { type Box, type Amount } from "@fleet-sdk/core";
    import {
        CheckCircle,
        Circle,
        Clock,
        History,
        User,
        Bot,
        RefreshCw,
        Sparkles,
        Gavel,
        Trophy,
        XCircle,
        ExternalLink,
        Eye,
        EyeOff,
        Info,
        MessageSquareWarningIcon,
        SendIcon,
    } from "lucide-svelte";
    import { formatDistanceToNow } from "date-fns";
    import { block_height_to_timestamp } from "$lib/common/countdown";
    import { ErgoPlatform } from "$lib/ergo/platform";
    import { type AnyParticipation } from "$lib/common/game";
    import { explorer_uri, web_explorer_uri_tx } from "$lib/ergo/envs";
    import { get } from "svelte/store";
    import {
        GAME,
        PARTICIPATION,
        PARTICIPATION_UNAVAILABLE,
    } from "$lib/ergo/reputation/types";
    import { getTransactionInfo, fetch_token_details } from "$lib/ergo/fetch";
    import { formatTokenBigInt } from "$lib/utils";

    export let history: AnyGame[] = [];
    export let currentGame: AnyGame | null = null;
    export let currentHeight: number = 0;
    export let participations: AnyParticipation[] = [];

    let showBotEvents = true;
    let isLoadingTimeline = false;

    // Helper to get a readable date and height from block height or timestamp
    async function getEventDetails(
        box: Box<Amount> | null,
    ): Promise<{ date: string; height: number; creationHeight: number }> {
        if (!box) return { date: "Unknown", height: 0, creationHeight: 0 };

        const txInfo = await getTransactionInfo(box.transactionId);
        if (txInfo && txInfo.timestamp) {
            return {
                date: new Date(txInfo.timestamp).toLocaleString(),
                height: txInfo.inclusionHeight || box.creationHeight,
                creationHeight: box.creationHeight,
            };
        }

        // Fallback to approximation
        const ts = await block_height_to_timestamp(
            box.creationHeight,
            new ErgoPlatform(),
        );
        return {
            date: new Date(ts).toLocaleString(),
            height: box.creationHeight,
            creationHeight: box.creationHeight,
        };
    }

    // Define timeline steps based on game state
    interface TimelineStep {
        id: string;
        label: string;
        description: string;
        status: "completed" | "active" | "pending" | "cancelled";
        date?: string;
        icon?: any;
        height: number;
        color: string;
        txId?: string;
        isBotEvent?: boolean;
        details?: Record<string, string | number | bigint>;
    }

    let expandedSteps = new Set<string>();

    function toggleStep(id: string) {
        if (expandedSteps.has(id)) {
            expandedSteps.delete(id);
        } else {
            expandedSteps.add(id);
        }
        expandedSteps = expandedSteps; // Trigger reactivity
    }

    let steps: TimelineStep[] = [];
    let filteredSteps: TimelineStep[] = [];

    const TIMELINE_ACCENT_COLORS: Record<string, string> = {
        "blue-400": "#60a5fa",
        "blue-500": "#3b82f6",
        "blue-600": "#2563eb",
        "purple-400": "#c084fc",
        "purple-500": "#a855f7",
        "yellow-500": "#eab308",
        "orange-500": "#f97316",
        "orange-600": "#ea580c",
        "red-500": "#ef4444",
        "red-600": "#dc2626",
        "lime-500": "#84cc16",
        "emerald-400": "#34d399",
        "emerald-500": "#10b981",
        "amber-500": "#f59e0b",
        "indigo-500": "#6366f1",
        "green-500": "#22c55e",
        "gray-400": "#9ca3af",
    };

    function getStepAccentColor(step: TimelineStep): string {
        if (step.status === "active") return "#3b82f6";
        if (step.status === "cancelled") return "#ef4444";

        // Extract token from classes like "text-purple-500 border-purple-500"
        const match = step.color?.match(/(?:text|border)-([a-z]+-\d{3})/);
        if (match?.[1] && TIMELINE_ACCENT_COLORS[match[1]]) {
            return TIMELINE_ACCENT_COLORS[match[1]];
        }

        return "hsl(var(--muted-foreground))";
    }

    function getStepDotStyle(step: TimelineStep): string {
        if (step.status === "pending") return "";
        const color = getStepAccentColor(step);
        return `color: ${color}; border-color: ${color};`;
    }

    async function formatPhaseCountdown(
        targetHeight: number,
        prefix = "Ends in",
    ): Promise<string> {
        const timestamp = await block_height_to_timestamp(
            targetHeight,
            new ErgoPlatform(),
        );
        return `${prefix} ~${formatDistanceToNow(new Date(timestamp))}`;
    }

    $: if (currentGame || history.length > 0 || participations.length > 0) {
        isLoadingTimeline = true;
        buildSteps(history, currentGame, currentHeight, participations).then(
            (s) => {
                steps = s;
                isLoadingTimeline = false;
            },
        );
    }

    $: filteredSteps = steps.filter((s) => showBotEvents || !s.isBotEvent);

    async function buildSteps(
        hist: AnyGame[],
        current: AnyGame | null,
        height: number,
        parts: AnyParticipation[],
    ) {
        const newSteps: TimelineStep[] = [];
        const addedBotBoxes = new Set<string>();

        // Fetch token details if applicable
        let decimals = 0;
        let tokenSymbol = "N/A";
        const referenceGame = current || (hist.length > 0 ? hist[0] : null);

        if (referenceGame && referenceGame.participationTokenId) {
            try {
                const tokenInfo = await fetch_token_details(
                    referenceGame.participationTokenId,
                );
                decimals = tokenInfo.decimals;
                tokenSymbol = tokenInfo.name;
            } catch (e) {
                console.error("Failed to fetch token details", e);
            }
        }

        // Find the first box that should have the creation parameters (Active/Resolution)
        const creationBox =
            hist.find((b) => b.status === GameState.Active) ||
            current ||
            (hist.length > 0 ? hist[0] : null);

        // 1. State Changes from history
        let lastSeed = "";
        for (let i = 0; i < hist.length; i++) {
            const g = hist[i];
            const h = g.box.creationHeight;
            const txId = g.box.transactionId;

            const { date: eventDate, height: eventHeight } =
                await getEventDetails(g.box);
            if (i === 0) {
                newSteps.push({
                    id: `created_${h}`,
                    label: "Game Created",
                    description: "The game was initialized on the blockchain.",
                    status: "completed",
                    date: eventDate,
                    icon: Sparkles,
                    height: eventHeight,
                    color: "text-blue-500 border-blue-500",
                    txId: txId,
                    details: {
                        "Box ID": g.boxId,
                        "Transaction ID": txId,
                        Height: eventHeight,
                        "Game ID": g.gameId,
                        "Creator Token": g.content.creatorTokenId || "None",
                        "Entry Fee": `${formatTokenBigInt(g.participationFeeAmount, decimals)} ${tokenSymbol}`,
                        "Initial Prize": `${formatTokenBigInt(g.value, decimals)} ${tokenSymbol}`,
                        "Resolver Commission": creationBox
                            ? `${(Number((creationBox as any).resolverCommission || 0) / 10000).toFixed(2)}%`
                            : "N/A",
                        "Judge Commission": creationBox
                            ? `${(Number((creationBox as any).perJudgeCommission || 0n) / 10000).toFixed(2)}% (per judge)`
                            : "N/A",
                    },
                });
                if ("seed" in g) lastSeed = g.seed;
            } else {
                const prevG = hist[i - 1];

                if (
                    g.status === GameState.Active &&
                    "seed" in g &&
                    g.seed !== lastSeed
                ) {
                    // Check if value/prize increased (Donation)
                    const currentPrize = g.value;

                    // access prevG safely
                    const prevG_any = prevG as any;
                    const prevPrize = prevG_any.value ?? 0n;

                    const prizeDiff = currentPrize - prevPrize;
                    const isDonation = prizeDiff > 0n;

                    let label = "Seed Updated";
                    let description = "Randomness was added to the game seed.";
                    let icon = RefreshCw;
                    let color = "text-purple-500 border-purple-500";

                    if (isDonation) {
                        label = "Prize Increased";
                        const formattedAmount = formatTokenBigInt(
                            prizeDiff,
                            decimals,
                        );
                        description = `Someone added ${formattedAmount} ${tokenSymbol} to the prize pool and updated the seed.`;
                        icon = Trophy;
                        color = "text-yellow-500 border-yellow-500";
                    }

                    newSteps.push({
                        id: `seed_updated_${h}`,
                        label: label,
                        description: description,
                        status: "completed",
                        date: eventDate,
                        icon: icon,
                        height: eventHeight,
                        color: color,
                        txId: txId,
                        details: {
                            "Box ID": g.boxId,
                            "Transaction ID": txId,
                            Height: eventHeight,
                            "New Seed": g.seed,
                            ...(isDonation
                                ? {
                                      "Added Amount": `${formatTokenBigInt(prizeDiff, decimals)} ${tokenSymbol}`,
                                  }
                                : {}),
                        },
                    });
                    lastSeed = g.seed;
                } else if (
                    g.status === GameState.Resolution &&
                    prevG.status !== GameState.Resolution
                ) {
                    newSteps.push({
                        id: `resolution_started_${h}`,
                        label: "Game seed was revealed.",
                        description:
                            "The game entered the resolution and judging phase.",
                        status: "completed",
                        date: eventDate,
                        icon: Gavel,
                        height: eventHeight,
                        color: "text-lime-500 border-lime-500",
                        txId: txId,
                        details: {
                            "Box ID": g.boxId,
                            "Transaction ID": txId,
                            Height: eventHeight,
                            "Revealed S": (g as any).revealedS_Hex,
                        },
                    });
                } else if (
                    g.status === GameState.Resolution &&
                    g.isEndGame &&
                    prevG.status === GameState.Resolution &&
                    !prevG.isEndGame
                ) {
                    // Resolution -> End game transition
                    let label = "Provisional endgame state.";
                    let description =
                        "The game moved into the provisional endgame state. Winner or resolver will have to spend all the participations and the funds will be distributed by the contract.";
                    let icon = Gavel;
                    let color = "text-lime-500 border-lime-500";
                    let details = {
                        "Box ID": g.boxId,
                        "Transaction ID": txId,
                        Height: eventHeight,
                    };

                    newSteps.push({
                        id: `resolution_endgame_${h}`,
                        label: label,
                        description: description,
                        status: "completed",
                        date: eventDate,
                        icon: SendIcon,
                        height: eventHeight,
                        color: color,
                        txId: txId,
                        details: details,
                    });
                } else if (
                    g.status === GameState.Resolution &&
                    !g.isEndGame &&
                    prevG.status === GameState.Resolution &&
                    !prevG.isEndGame
                ) {
                    // Resolution -> Resolution transition
                    const prevCandidate = (prevG as any)
                        .winnerCandidateCommitment;
                    const newCandidate = (g as any).winnerCandidateCommitment;
                    const prevResolverCommission = (prevG as any)
                        .resolverCommission;
                    const resolverCommission = (g as any).resolverCommission;
                    const prevResolver = (prevG as any).resolverScript_Hex;
                    const resolver = (g as any).resolverScript_Hex;

                    let label = "Resolution Updated";
                    let description =
                        "The resolution state was updated (Unknown reason).";
                    let icon = Gavel;
                    let color = "text-orange-500 border-orange-500";

                    // Rule 1: Candidate Added -> Omitted Participation
                    if (prevCandidate !== newCandidate && newCandidate) {
                        label = "Candidate Selected";
                        description = `Resolver selected candidate ${newCandidate.slice(0, 8)}... (Omitted Participation logic applied).`;
                        if (prevResolver !== resolver) {
                            description += ` Resolver changed from ${prevResolver?.slice(0, 8)}... to ${resolver?.slice(0, 8)}...`;
                        } else {
                            description += ` Resolver remains the same.`;
                        }
                        icon = User;
                        color = "text-blue-500 border-blue-500";
                    }
                    // Rule 2: Candidate Removed -> Invalidation
                    else if (prevCandidate && !newCandidate) {
                        // Check commission to determine type of invalidation
                        if (resolverCommission === 0) {
                            label = "Candidate Invalidated";
                            description = `Judges invalidated candidate ${prevCandidate.slice(0, 8)}...`;
                            icon = XCircle;
                            color = "text-red-500 border-red-500";
                        } else {
                            label = "Candidate Unavailable";
                            description = `Judges declared candidate ${prevCandidate.slice(0, 8)}... unavailable (Service/Bot not found).`;
                            icon = EyeOff;
                            color = "text-orange-600 border-orange-600";
                        }
                    }
                    // Fallback for other changes (e.g. just commission change or candidate swap if possible)
                    else if (prevCandidate !== newCandidate) {
                        label = "Candidate Changed";
                        description = `Candidate changed from ${prevCandidate?.slice(0, 8)}... to ${newCandidate?.slice(0, 8)}... (Unknown reason).`;
                    } else if (prevResolverCommission !== resolverCommission) {
                        label = "Resolver Commission Changed";
                        description = `Resolver commission changed from ${prevResolverCommission} to ${resolverCommission} (Unknown reason).`;
                    } else if (
                        prevCandidate === newCandidate &&
                        prevResolverCommission === resolverCommission
                    ) {
                        label = "Resolution Updated";
                        description = `Resolution state was updated without changes (Unknown reason).`;
                    }

                    newSteps.push({
                        id: `resolution_update_${h}`,
                        label: label,
                        description: description,
                        status: "completed",
                        date: eventDate,
                        icon: icon,
                        height: eventHeight,
                        color: color,
                        txId: txId,
                        details: {
                            "Box ID": g.boxId,
                            "Transaction ID": txId,
                            Height: eventHeight,
                            "New Candidate Commitment": newCandidate || "N/A",
                            "Resolver Commission": `${(Number(resolverCommission) / 10000).toFixed(2)}%`,
                            Resolver: resolver,
                        },
                    });
                } else if (g.status === GameState.Cancelled_Draining) {
                    const g_cancel = g as any;
                    const drainPortion = g_cancel.portionToClaim;
                    const currentValue = g_cancel.value;
                    const isUnlocked = height >= g_cancel.unlockHeight;
                    const unlockTimestamp = await block_height_to_timestamp(
                        g_cancel.unlockHeight,
                        new ErgoPlatform(),
                    );
                    const countdown = formatDistanceToNow(
                        new Date(unlockTimestamp),
                    );

                    newSteps.push({
                        id: `cancelled_${h}`,
                        label: "Game Cancelled",
                        description: isUnlocked
                            ? `The game was cancelled. Stake draining is available!`
                            : `The game was cancelled. Next drain available in ~${countdown}.`,
                        status: "completed",
                        date: eventDate,
                        icon: XCircle,
                        height: eventHeight,
                        color: "text-red-500 border-red-500",
                        txId: txId,
                        details: {
                            "Box ID": g.boxId,
                            "Transaction ID": txId,
                            Height: eventHeight,
                            "Current Contract Value": `${formatTokenBigInt(currentValue, decimals)} ${tokenSymbol}`,
                            "Constant Drain Amount": `${formatTokenBigInt(drainPortion, decimals)} ${tokenSymbol}`,
                            "Unlock Height": g_cancel.unlockHeight,
                            "Original Deadline": g_cancel.deadlineBlock,
                            "Revealed S": g_cancel.revealedS_Hex || "None",
                        },
                    });
                } else if (g.status === GameState.Finalized) {
                    newSteps.push({
                        id: `finalized_${h}`,
                        label: "Game Finalized",
                        description:
                            "The game was finalized and prizes were distributed.",
                        status: "completed",
                        date: eventDate,
                        icon: Trophy,
                        height: eventHeight,
                        color: "text-yellow-500 border-yellow-500",
                        txId: txId,
                        details: {
                            "Box ID": g.boxId,
                            "Transaction ID": txId,
                            Height: eventHeight,
                            "Final Prize Pool": `${formatTokenBigInt(g.value, decimals)} ${tokenSymbol}`,
                        },
                    });
                } else {
                    // Unknown transition - provide all data.
                    newSteps.push({
                        id: `unknown_transition_${h}`,
                        label: "Unknown transition",
                        description:
                            "The game state was updated (Unknown reason).",
                        status: "completed",
                        date: eventDate,
                        icon: MessageSquareWarningIcon,
                        height: eventHeight,
                        color: "text-orange-500 border-orange-500",
                        txId: txId,
                        details: {
                            // All the data
                            "Box ID": g.boxId,
                            "Transaction ID": txId,
                            Height: eventHeight,
                            "Previous Game State": prevG.status,
                            "Previous Game Is End Game":
                                prevG.status === GameState.Resolution
                                    ? prevG.isEndGame
                                        ? "Yes"
                                        : "No"
                                    : "N/A",
                            "Current Game State": g.status,
                            "Current Game Is End Game":
                                g.status === GameState.Resolution
                                    ? g.isEndGame
                                        ? "Yes"
                                        : "No"
                                    : "N/A",
                        },
                    });
                }
            }
        }

        // 2. Participations and their Bot Boxes
        for (const p of parts) {
            const {
                date: pDate,
                height: pHeight,
                creationHeight: cHeight,
            } = await getEventDetails(p.box);

            // Participation Event
            // Calculate efficient score details if we have the necessary data
            let efficientScoreDetails = {};
            if (current && "constants" in current && p.solverIdBox) {
                const timeWeight = Number(
                    "timeWeight" in current ? current.timeWeight : 0,
                );
                const deadline = Number(current.deadlineBlock);
                const createdAt = Number(
                    current.createdAt || current.box.creationHeight,
                );
                const minTimeWeightMargin = Number(
                    current.constants.MIN_TIME_WEIGHT_MARGIN || 0,
                );

                // Get bot box height
                const botBoxHeight = Number(p.solverIdBox.creationHeight);
                const effectiveBotHeight = Math.max(
                    botBoxHeight,
                    createdAt + minTimeWeightMargin,
                );
                const remainingBlocks = deadline - effectiveBotHeight;
                const timeMultiplier = 1 + timeWeight * remainingBlocks;

                efficientScoreDetails = {
                    "Time Weight (ω)": timeWeight,
                    "Bot Box Height (B_box)": botBoxHeight,
                    "Effective Bot Height": effectiveBotHeight,
                    "Deadline (B_deadline)": deadline,
                    "Remaining Blocks": remainingBlocks,
                    "Time Multiplier": `${timeMultiplier.toLocaleString()} (1 + ${timeWeight} × ${remainingBlocks})`,
                    Formula: "S_efficient = S_raw × Time Multiplier",
                };
            }

            newSteps.push({
                id: `part_${p.boxId}`,
                label: "New Participation",
                description: `Player ${p.playerPK_Hex?.slice(0, 8)}... submitted a score.`,
                status: "completed",
                date: pDate,
                icon: User,
                height: pHeight,
                color: "text-emerald-500 border-emerald-500",
                txId: p.transactionId,
                details: {
                    "Box ID": p.boxId,
                    "Transaction ID": p.transactionId,
                    "Included in Block": pHeight,
                    "Creation height": cHeight,
                    "Player PK": p.playerPK_Hex || "Unknown",
                    "Fee Paid": `${formatTokenBigInt(p.value, decimals)} ${tokenSymbol}`,
                    Commitment: p.commitmentC_Hex,
                    "Solver ID": p.solverId_RawBytesHex,
                    ...efficientScoreDetails,
                },
            });

            // Bot Box Event (if available)
            if (p.solverIdBox && !addedBotBoxes.has(p.solverIdBox.boxId)) {
                addedBotBoxes.add(p.solverIdBox.boxId);
                const {
                    date: botDate,
                    height: botHeight,
                    creationHeight: botCHeight,
                } = await getEventDetails(p.solverIdBox);
                newSteps.push({
                    id: `bot_box_${p.solverIdBox.boxId}`,
                    label: "Bot Uploaded",
                    description: `Player uploaded their bot code (Box: ${p.solverIdBox.boxId.slice(0, 8)}...).`,
                    status: "completed",
                    date: botDate,
                    icon: Bot,
                    height: botHeight,
                    color: "text-amber-500 border-amber-500",
                    txId: p.solverIdBox.transactionId,
                    isBotEvent: true,
                    details: {
                        "Box ID": p.solverIdBox.boxId,
                        "Transaction ID": p.solverIdBox.transactionId,
                        "Included in Block": botHeight,
                        "Creation height": botCHeight,
                        "Solver ID": p.solverId_RawBytesHex,
                    },
                });
            }

            // Judge Opinions on Participation
            if (p.reputationOpinions && current && "judges" in current) {
                // Check if participation is locally determined as malformed (only possible in Resolution/Finalized)
                let isMalformed = false;
                if (
                    (current.status === GameState.Resolution ||
                        current.status === GameState.Finalized) &&
                    "revealedS_Hex" in current &&
                    "seed" in current
                ) {
                    const score = resolve_participation_commitment(
                        p,
                        current.revealedS_Hex,
                        current.seed,
                    );
                    if (score === null) isMalformed = true;
                }

                if (!isMalformed) {
                    // Track vote counts to detect majority
                    const totalJudges = current.judges.length;
                    const majorityThreshold = Math.floor(totalJudges / 2) + 1;

                    // Count votes by type for this participation
                    let invalidVoteCount = 0;
                    let unavailableVoteCount = 0;

                    // First pass: count all votes
                    for (const opinion of p.reputationOpinions) {
                        if (current.judges.includes(opinion.token_id)) {
                            const isUnavailable =
                                opinion.type.tokenId ===
                                PARTICIPATION_UNAVAILABLE;
                            const isParticipation =
                                opinion.type.tokenId === PARTICIPATION;

                            if (
                                isParticipation &&
                                opinion.polarization === false
                            ) {
                                invalidVoteCount++;
                            } else if (isUnavailable) {
                                unavailableVoteCount++;
                            }
                        }
                    }

                    // Second pass: create events and detect majority
                    let currentInvalidCount = 0;
                    let currentUnavailableCount = 0;
                    let majorityInvalidReached = false;
                    let majorityUnavailableReached = false;

                    for (const opinion of p.reputationOpinions) {
                        // Check if opinion is from a nominated judge
                        if (current.judges.includes(opinion.token_id)) {
                            const isUnavailable =
                                opinion.type.tokenId ===
                                PARTICIPATION_UNAVAILABLE;
                            const isParticipation =
                                opinion.type.tokenId === PARTICIPATION;

                            if (isParticipation || isUnavailable) {
                                const { date: opDate, height: opHeight } =
                                    await getEventDetails(opinion.box);

                                let label = "Judge Voted";
                                let description = `Judge ${opinion.token_id.slice(0, 8)}... voted on participation ${p.commitmentC_Hex.slice(0, 8)}...`;
                                let icon = Gavel;
                                let color = "text-blue-400 border-blue-400";

                                const isInvalid =
                                    isParticipation &&
                                    opinion.polarization === false;

                                if (isUnavailable) {
                                    label = "Participation Unavailable";
                                    description = `Judge ${opinion.token_id.slice(0, 8)}... marked participation ${p.commitmentC_Hex.slice(0, 8)}... as unavailable.`;
                                    icon = EyeOff;
                                    color = "text-orange-500 border-orange-500";
                                    currentUnavailableCount++;
                                } else if (isInvalid) {
                                    label = "Participation Invalid";
                                    description = `Judge ${opinion.token_id.slice(0, 8)}... marked participation ${p.commitmentC_Hex.slice(0, 8)}... as invalid.`;
                                    icon = XCircle;
                                    color = "text-red-500 border-red-500";
                                    currentInvalidCount++;
                                } else {
                                    label = "Participation Valid";
                                    description = `Judge ${opinion.token_id.slice(0, 8)}... marked participation ${p.commitmentC_Hex.slice(0, 8)}... as valid.`;
                                    icon = CheckCircle;
                                    color = "text-green-500 border-green-500";
                                }

                                newSteps.push({
                                    id: `op_part_${opinion.box_id}`,
                                    label: label,
                                    description: description,
                                    status: "completed",
                                    date: opDate,
                                    icon: icon,
                                    height: opHeight,
                                    color: color,
                                    txId: opinion.box_id,
                                    details: {
                                        "Opinion Box ID": opinion.box_id,
                                        "Judge Token": opinion.token_id,
                                        Height: opHeight,
                                        Polarization: opinion.polarization
                                            ? "Positive"
                                            : "Negative",
                                        "Target Commitment": p.commitmentC_Hex,
                                    },
                                });

                                // Check if this vote triggered majority
                                if (
                                    isInvalid &&
                                    currentInvalidCount === majorityThreshold &&
                                    !majorityInvalidReached
                                ) {
                                    majorityInvalidReached = true;
                                    newSteps.push({
                                        id: `majority_invalid_${p.commitmentC_Hex}_${opHeight}`,
                                        label: "Majority Reached - Invalid",
                                        description: `Judges reached majority (${majorityThreshold}/${totalJudges}) to invalidate participation ${p.commitmentC_Hex.slice(0, 8)}...`,
                                        status: "completed",
                                        date: opDate,
                                        icon: Gavel,
                                        height: opHeight,
                                        color: "text-red-600 border-red-600",
                                        txId: opinion.box_id,
                                        details: {
                                            "Majority Type": "Invalidation",
                                            "Votes Required": majorityThreshold,
                                            "Total Judges": totalJudges,
                                        },
                                    });
                                } else if (
                                    isUnavailable &&
                                    currentUnavailableCount ===
                                        majorityThreshold &&
                                    !majorityUnavailableReached
                                ) {
                                    majorityUnavailableReached = true;
                                    newSteps.push({
                                        id: `majority_unavailable_${p.commitmentC_Hex}_${opHeight}`,
                                        label: "Majority Reached - Unavailable",
                                        description: `Judges reached majority (${majorityThreshold}/${totalJudges}) to mark participation ${p.commitmentC_Hex.slice(0, 8)}... as unavailable.`,
                                        status: "completed",
                                        date: opDate,
                                        icon: Gavel,
                                        height: opHeight,
                                        color: "text-orange-600 border-orange-600",
                                        txId: opinion.box_id,
                                        details: {
                                            "Majority Type": "Unavailable",
                                            "Votes Required": majorityThreshold,
                                            "Total Judges": totalJudges,
                                        },
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }

        // 4. Judge Game Acceptance (from current game or history)
        // We look at the latest game state to get the list of judges and opinions
        const gameToCheck =
            current || (hist.length > 0 ? hist[hist.length - 1] : null);
        if (
            gameToCheck &&
            "reputationOpinions" in gameToCheck &&
            "judges" in gameToCheck
        ) {
            for (const opinion of gameToCheck.reputationOpinions) {
                if (
                    gameToCheck.judges.includes(opinion.token_id) &&
                    opinion.type.tokenId === GAME
                ) {
                    const { date: opDate, height: opHeight } =
                        await getEventDetails(opinion.box);
                    newSteps.push({
                        id: `op_game_${opinion.box_id}`,
                        label: "Judge Accepted",
                        description: `Judge ${opinion.token_id.slice(0, 8)}... accepted the game.`,
                        status: "completed",
                        date: opDate,
                        icon: Gavel,
                        height: opHeight,
                        color: "text-indigo-500 border-indigo-500",
                        txId: opinion.box_id,
                        details: {
                            "Opinion Box ID": opinion.box_id,
                            "Judge Token": opinion.token_id,
                            Height: opHeight,
                            "Game ID": gameToCheck.gameId,
                        },
                    });
                }
            }
        }

        // Sort all completed steps by height
        newSteps.sort((a, b) => a.height - b.height);

        // Add past deadlines as completed events
        if (current) {
            if ("ceremonyDeadline" in current && "constants" in current) {
                const participationWindow =
                    current.constants.PARTICIPATION_TIME_WINDOW;
                const seedMargin = current.constants.SEED_MARGIN;
                const deadline = current.deadlineBlock;

                // Solver Hash Deadline (deadline - participation_window - seed_margin)
                const solverHashDeadline =
                    deadline - participationWindow - seedMargin;
                if (height >= solverHashDeadline) {
                    const deadlineTimestamp = await block_height_to_timestamp(
                        solverHashDeadline,
                        new ErgoPlatform(),
                    );
                    newSteps.push({
                        id: `past_solver_hash_deadline`,
                        label: "Bot Upload Deadline Passed",
                        description: "The solver upload window ended.",
                        status: "completed",
                        date: new Date(deadlineTimestamp).toLocaleString(),
                        icon: Bot,
                        height: solverHashDeadline,
                        color: "text-blue-400 border-blue-400",
                        details: {
                            "Deadline Type": "Solver Hash Submission",
                            "Block Height": solverHashDeadline,
                            Calculation: `deadline (${deadline}) - participation_window (${participationWindow}) - seed_margin (${seedMargin})`,
                        },
                    });
                }

                // Ceremony Seed Deadline (deadline - participation_window)
                const ceremonySeedDeadline = deadline - participationWindow;
                if (height >= ceremonySeedDeadline) {
                    const deadlineTimestamp = await block_height_to_timestamp(
                        ceremonySeedDeadline,
                        new ErgoPlatform(),
                    );
                    newSteps.push({
                        id: `past_ceremony_seed_deadline`,
                        label: "Ceremony Deadline Passed",
                        description: "The seed-randomness window ended.",
                        status: "completed",
                        date: new Date(deadlineTimestamp).toLocaleString(),
                        icon: RefreshCw,
                        height: ceremonySeedDeadline,
                        color: "text-purple-400 border-purple-400",
                        details: {
                            "Deadline Type": "Ceremony Seed",
                            "Block Height": ceremonySeedDeadline,
                            Calculation: `deadline (${deadline}) - participation_window (${participationWindow})`,
                        },
                    });
                }
            }

            // Participation Deadline (deadline)
            const participationDeadline = current.deadlineBlock;
            if (height >= participationDeadline) {
                const deadlineTimestamp = await block_height_to_timestamp(
                    participationDeadline,
                    new ErgoPlatform(),
                );
                newSteps.push({
                    id: `past_participation_deadline`,
                    label: "Participation Deadline Passed",
                    description: "Game execution period ended.",
                    status: "completed",
                    date: new Date(deadlineTimestamp).toLocaleString(),
                    icon: Sparkles,
                    height: participationDeadline,
                    color: "text-emerald-400 border-emerald-400",
                    details: {
                        "Deadline Type": "Participation/Execution",
                        "Block Height": participationDeadline,
                    },
                });

                // Suspended State (deadline + grace period)
                const suspendedHeight =
                    participationDeadline +
                    current.constants.PARTICIPATION_GRACE_PERIOD;
                if (
                    height >= suspendedHeight &&
                    current.status === GameState.Active
                ) {
                    const suspendedTimestamp = await block_height_to_timestamp(
                        suspendedHeight,
                        new ErgoPlatform(),
                    );
                    newSteps.push({
                        id: `past_suspended`,
                        label: "Game Suspended",
                        description:
                            "The resolution grace period ended. Creator stake is locked and players can claim refunds.",
                        status: "completed",
                        date: new Date(suspendedTimestamp).toLocaleString(),
                        icon: EyeOff,
                        height: suspendedHeight,
                        color: "text-red-500 border-red-500",
                        details: {
                            Reason: "Resolution Deadline Passed",
                            "Block Height": suspendedHeight,
                            "Grace Period":
                                current.constants.PARTICIPATION_GRACE_PERIOD,
                        },
                    });
                }
            }
        }

        // Re-sort to include past deadlines in chronological order
        newSteps.sort((a, b) => a.height - b.height);

        // 4. Future/Current Steps (only if game is not finalized/cancelled)
        if (current) {
            const phaseSnapshot: GamePhaseSnapshot = deriveGamePhaseSnapshot(
                current,
                height,
            );

            if (current.status === GameState.Active) {
                const hashDeadline =
                    current.ceremonyDeadline - current.constants.SEED_MARGIN;
                const seedDeadline = current.ceremonyDeadline;
                const participationDeadline = current.deadlineBlock;
                const suspendedHeight =
                    current.deadlineBlock +
                    current.constants.PARTICIPATION_GRACE_PERIOD;

                if (phaseSnapshot.subphase === "strategy_upload") {
                    newSteps.push({
                        id: "phase_strategy_upload",
                        label: "Strategy & Upload",
                        description:
                            "Players can still upload solver services while anyone can keep adding randomness to the seed.",
                        status: "active",
                        date: await formatPhaseCountdown(hashDeadline),
                        icon: Bot,
                        height: hashDeadline,
                        color: "text-indigo-500 border-indigo-500",
                    });
                    newSteps.push({
                        id: "phase_seed_lockdown",
                        label: "Seed Lockdown",
                        description:
                            "Bot uploads close, but the ceremony stays open until the seed deadline.",
                        status: "pending",
                        date: await formatPhaseCountdown(seedDeadline),
                        icon: RefreshCw,
                        height: seedDeadline,
                        color: "text-amber-500 border-amber-500",
                    });
                    newSteps.push({
                        id: "phase_playing",
                        label: "Playing",
                        description:
                            "Once the seed is fixed, players can execute their bots and submit participations.",
                        status: "pending",
                        date: await formatPhaseCountdown(participationDeadline),
                        icon: Sparkles,
                        height: participationDeadline,
                        color: "text-emerald-500 border-emerald-500",
                    });
                    newSteps.push({
                        id: "phase_awaiting_resolution",
                        label: "Awaiting Resolution",
                        description:
                            "After participation closes, the creator can reveal the secret before the game becomes suspended.",
                        status: "pending",
                        date: await formatPhaseCountdown(
                            suspendedHeight,
                            "Would suspend in",
                        ),
                        icon: Clock,
                        height: suspendedHeight,
                        color: "text-orange-500 border-orange-500",
                    });
                } else if (phaseSnapshot.subphase === "seed_lockdown") {
                    newSteps.push({
                        id: "phase_seed_lockdown",
                        label: "Seed Lockdown",
                        description:
                            "Bot uploads are closed. Anyone can still add randomness until the ceremony deadline.",
                        status: "active",
                        date: await formatPhaseCountdown(seedDeadline),
                        icon: RefreshCw,
                        height: seedDeadline,
                        color: "text-amber-500 border-amber-500",
                    });
                    newSteps.push({
                        id: "phase_playing",
                        label: "Playing",
                        description:
                            "Once the seed is fixed, players can execute their bots and submit participations.",
                        status: "pending",
                        date: await formatPhaseCountdown(participationDeadline),
                        icon: Sparkles,
                        height: participationDeadline,
                        color: "text-emerald-500 border-emerald-500",
                    });
                    newSteps.push({
                        id: "phase_awaiting_resolution",
                        label: "Awaiting Resolution",
                        description:
                            "After participation closes, the creator can reveal the secret before the game becomes suspended.",
                        status: "pending",
                        date: await formatPhaseCountdown(
                            suspendedHeight,
                            "Would suspend in",
                        ),
                        icon: Clock,
                        height: suspendedHeight,
                        color: "text-orange-500 border-orange-500",
                    });
                } else if (phaseSnapshot.subphase === "playing") {
                    newSteps.push({
                        id: "phase_playing",
                        label: "Playing",
                        description:
                            "The seed is fixed and players can publish participations until the deadline.",
                        status: "active",
                        date: await formatPhaseCountdown(participationDeadline),
                        icon: Sparkles,
                        height: participationDeadline,
                        color: "text-emerald-500 border-emerald-500",
                    });
                    newSteps.push({
                        id: "phase_awaiting_resolution",
                        label: "Awaiting Resolution",
                        description:
                            "After participation closes, the creator can reveal the secret before the game becomes suspended.",
                        status: "pending",
                        date: await formatPhaseCountdown(
                            suspendedHeight,
                            "Would suspend in",
                        ),
                        icon: Clock,
                        height: suspendedHeight,
                        color: "text-orange-500 border-orange-500",
                    });
                } else if (phaseSnapshot.subphase === "awaiting_resolution") {
                    newSteps.push({
                        id: "phase_awaiting_resolution",
                        label: "Awaiting Resolution",
                        description:
                            "Participation is closed and the creator must reveal the secret before the grace period expires.",
                        status: "active",
                        date: await formatPhaseCountdown(
                            suspendedHeight,
                            "Suspends in",
                        ),
                        icon: Clock,
                        height: suspendedHeight,
                        color: "text-orange-500 border-orange-500",
                    });
                    newSteps.push({
                        id: "phase_judging_pending",
                        label: "Judging",
                        description:
                            "Begins only if the creator reveals the secret before suspension.",
                        status: "pending",
                        icon: Gavel,
                        height: 9999999,
                        color: "text-lime-500 border-lime-500",
                    });
                } else if (phaseSnapshot.subphase === "suspended") {
                    const suspendedTimestamp = await block_height_to_timestamp(
                        suspendedHeight,
                        new ErgoPlatform(),
                    );
                    newSteps.push({
                        id: "phase_suspended",
                        label: "Suspended",
                        description:
                            "The creator missed the resolution window. Players can now claim refunds.",
                        status: "active",
                        date: `Started ${formatDistanceToNow(new Date(suspendedTimestamp), { addSuffix: true })}`,
                        icon: EyeOff,
                        height: suspendedHeight,
                        color: "text-red-500 border-red-500",
                    });
                }
            }

            if (current.status === GameState.Resolution) {
                if (phaseSnapshot.subphase === "judging") {
                    newSteps.push({
                        id: "phase_judging",
                        label: "Judging",
                        description:
                            "The secret is revealed and judges can verify or challenge the current winner candidate.",
                        status: "active",
                        date: await formatPhaseCountdown(
                            current.resolutionDeadline,
                        ),
                        icon: Gavel,
                        height: current.resolutionDeadline,
                        color: "text-lime-500 border-lime-500",
                    });
                    newSteps.push({
                        id: "phase_ready_to_finalize",
                        label: "Ready to Finalize",
                        description:
                            "Once the judge window ends, the game can be finalized and payouts distributed.",
                        status: "pending",
                        icon: Trophy,
                        height: 9999999,
                        color: "text-yellow-500 border-yellow-500",
                    });
                } else {
                    newSteps.push({
                        id: "phase_ready_to_finalize",
                        label: "Ready to Finalize",
                        description:
                            "The judge window ended. The game can now be finalized and payouts distributed.",
                        status: "active",
                        icon: Trophy,
                        height: 9999999,
                        color: "text-yellow-500 border-yellow-500",
                    });
                }
            }

            if (current.status === GameState.Finalized) {
                newSteps.push({
                    id: "finalized",
                    label: "Finalized",
                    description:
                        "The game is complete and the winner has been paid.",
                    status: "completed",
                    icon: Trophy,
                    height: 9999999,
                    color: "text-yellow-500 border-yellow-500",
                    txId: current.box.transactionId,
                });
            } else if (current.status === GameState.Cancelled_Draining) {
                const drainPortion = current.portionToClaim;
                const currentValue = current.value;
                const isUnlocked =
                    phaseSnapshot.subphase === "cancelled_draining";

                newSteps.push({
                    id: "cancelled",
                    label: isUnlocked
                        ? "Cancelled / Draining"
                        : "Cancelled / Cooldown",
                    description: isUnlocked
                        ? "The game is cancelled and the next creator-stake drain is unlocked."
                        : "The game is cancelled. Players can refund now, but the next creator-stake drain is still cooling down.",
                    status: "active",
                    date: isUnlocked
                        ? "Unlocked"
                        : await formatPhaseCountdown(
                              current.unlockHeight,
                              "Unlocks in",
                          ),
                    icon: XCircle,
                    height: 9999999,
                    color: "text-red-500 border-red-500",
                    txId: current.box.transactionId,
                    details: {
                        "Box ID": current.boxId,
                        "Unlock Height": current.unlockHeight,
                        "Current Contract Value": `${formatTokenBigInt(currentValue, decimals)} ${tokenSymbol}`,
                        "Constant Drain Amount": `${formatTokenBigInt(drainPortion, decimals)} ${tokenSymbol}`,
                        "Original Deadline": current.deadlineBlock,
                        "Revealed S": current.revealedS_Hex || "None",
                    },
                });
            } else if (phaseSnapshot.subphase !== "suspended") {
                newSteps.push({
                    id: "future_finalized",
                    label: "Finalized",
                    description:
                        "This is the successful end of the standard path, after payouts are distributed.",
                    status: "pending",
                    icon: Trophy,
                    height: 10000000,
                    color: "text-gray-400 border-gray-400",
                });
            }
        }

        return newSteps;
    }
</script>

<div class="space-y-6 p-4">
    <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-2">
            <History class="w-6 h-6 text-blue-500" />
            <h3 class="text-xl font-bold">Game Event Timeline</h3>
        </div>
        {#if false}
            <button
                class="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-full border transition-colors
                   {showBotEvents
                    ? 'bg-amber-500/10 text-amber-600 border-amber-200'
                    : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'}"
                on:click={() => (showBotEvents = !showBotEvents)}
            >
                {#if showBotEvents}
                    <Eye class="w-3.5 h-3.5" />
                    Hide Bot Uploads
                {:else}
                    <EyeOff class="w-3.5 h-3.5" />
                    Show Bot Uploads
                {/if}
            </button>
        {/if}
    </div>

    {#if isLoadingTimeline}
        <div class="flex items-center justify-center py-12 space-x-3">
            <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="text-muted-foreground">Loading timeline...</p>
        </div>
    {:else}
        <div class="relative pl-8 border-l-2 border-muted space-y-10">
            {#each filteredSteps as step, i}
                <div class="relative">
                    <!-- Dot Indicator -->
                    <div
                        class="absolute -left-[45px] top-0 flex items-center justify-center w-8 h-8 rounded-full bg-background border-2
                    {step.status === 'completed'
                            ? 'border-current text-current'
                            : step.status === 'active'
                              ? 'border-current text-current shadow-[0_0_10px_rgba(59,130,246,0.5)]'
                              : step.status === 'cancelled'
                                ? 'border-current text-current'
                                : 'border-muted text-muted-foreground'}"
                        style={getStepDotStyle(step)}
                    >
                        {#if step.icon}
                            <svelte:component
                                this={step.icon}
                                class="w-4 h-4"
                            />
                        {:else}
                            <Circle class="w-3 h-3 fill-current" />
                        {/if}
                    </div>

                    <!-- Content -->
                    <div
                        class="flex flex-col gap-1 bg-card/50 p-4 rounded-lg border border-border/50 hover:border-primary/30 transition-colors"
                    >
                        <div class="flex items-center justify-between gap-2">
                            <span
                                class="font-bold text-lg text-foreground {step.status ===
                                'active'
                                    ? 'text-blue-500'
                                    : ''} {step.status === 'cancelled'
                                    ? 'text-red-500'
                                    : ''}"
                            >
                                {step.label}
                            </span>
                            <div class="flex items-center gap-2">
                                {#if step.status === "active"}
                                    <span
                                        class="text-[10px] uppercase tracking-wider font-bold bg-blue-500 text-white px-2 py-0.5 rounded animate-pulse"
                                    >
                                        Active
                                    </span>
                                {/if}
                                {#if step.txId}
                                    <a
                                        href="{$web_explorer_uri_tx}{step.txId}"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        class="text-muted-foreground hover:text-primary transition-colors"
                                        title="View Transaction"
                                    >
                                        <ExternalLink class="w-4 h-4" />
                                    </a>
                                {/if}
                                {#if step.details}
                                    <button
                                        class="text-muted-foreground hover:text-primary transition-colors"
                                        on:click={() => toggleStep(step.id)}
                                        title="Show Details"
                                    >
                                        <Info class="w-4 h-4" />
                                    </button>
                                {/if}
                            </div>
                        </div>
                        <p class="text-sm text-muted-foreground">
                            {step.description}
                        </p>

                        {#if step.details && expandedSteps.has(step.id)}
                            <div
                                class="mt-3 p-3 rounded bg-muted/30 border border-border/50 text-xs font-mono space-y-1.5 overflow-x-auto"
                            >
                                {#each Object.entries(step.details) as [key, value]}
                                    <div class="flex gap-2">
                                        <span
                                            class="text-muted-foreground whitespace-nowrap"
                                            >{key}:</span
                                        >
                                        <span class="text-foreground break-all"
                                            >{value}</span
                                        >
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        {#if step.date}
                            <div
                                class="flex items-center gap-1.5 text-xs font-medium text-muted-foreground mt-2 pt-2 border-t border-border/30"
                            >
                                <Clock class="w-3.5 h-3.5" />
                                <span>{step.date}</span>
                                {#if step.height && step.status === "completed"}
                                    <span class="ml-auto opacity-60"
                                        >Block: {step.height}</span
                                    >
                                {/if}
                            </div>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
