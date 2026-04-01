import { type AnyGame, GameState } from "$lib/common/game";

export const GameContractPhase = {
    ACTIVE: "active",
    RESOLUTION: "resolution",
    CANCELLED: "cancelled",
    FINALIZED: "finalized",
    UNKNOWN: "unknown",
} as const;

export type GameContractPhaseValue =
    (typeof GameContractPhase)[keyof typeof GameContractPhase];

export const GameUiSubphase = {
    STRATEGY_UPLOAD: "strategy_upload",
    SEED_LOCKDOWN: "seed_lockdown",
    PLAYING: "playing",
    AWAITING_RESOLUTION: "awaiting_resolution",
    SUSPENDED: "suspended",
    JUDGING: "judging",
    READY_TO_FINALIZE: "ready_to_finalize",
    CANCELLED_LOCKED: "cancelled_locked",
    CANCELLED_DRAINING: "cancelled_draining",
    FINALIZED: "finalized",
    UNKNOWN: "unknown",
} as const;

export type GameUiSubphaseValue =
    (typeof GameUiSubphase)[keyof typeof GameUiSubphase];

export interface GamePhaseDefinition {
    contractPhase: GameContractPhaseValue;
    contractLabel: string;
    label: string;
    title: string;
    description: string;
}

export interface GamePhaseSnapshot {
    currentHeight: number;
    openCeremony: boolean;
    openSolverSubmit: boolean;
    participationIsEnded: boolean;
    resolutionAllowed: boolean;
    gameSuspended: boolean;
    contractPhase: GameContractPhaseValue;
    subphase: GameUiSubphaseValue;
    contractLabel: string;
    label: string;
    title: string;
    description: string;
}

export const ACTIVE_SUBPHASE_SEQUENCE: GameUiSubphaseValue[] = [
    GameUiSubphase.STRATEGY_UPLOAD,
    GameUiSubphase.SEED_LOCKDOWN,
    GameUiSubphase.PLAYING,
    GameUiSubphase.AWAITING_RESOLUTION,
    GameUiSubphase.SUSPENDED,
];

export const RESOLUTION_SUBPHASE_SEQUENCE: GameUiSubphaseValue[] = [
    GameUiSubphase.JUDGING,
    GameUiSubphase.READY_TO_FINALIZE,
];

export const CANCELLATION_SUBPHASE_SEQUENCE: GameUiSubphaseValue[] = [
    GameUiSubphase.CANCELLED_LOCKED,
    GameUiSubphase.CANCELLED_DRAINING,
];

export const FINALIZED_SUBPHASE_SEQUENCE: GameUiSubphaseValue[] = [
    GameUiSubphase.FINALIZED,
];

export const GAME_PHASE_DEFINITIONS: Record<
    GameUiSubphaseValue,
    GamePhaseDefinition
> = {
    [GameUiSubphase.STRATEGY_UPLOAD]: {
        contractPhase: GameContractPhase.ACTIVE,
        contractLabel: "ACTIVE",
        label: "Strategy & Upload",
        title: "Strategy & Upload",
        description:
            "The contract is still ACTIVE. Players can register or upload solver services, and anyone can continue adding randomness to the seed.",
    },
    [GameUiSubphase.SEED_LOCKDOWN]: {
        contractPhase: GameContractPhase.ACTIVE,
        contractLabel: "ACTIVE",
        label: "Seed Lockdown",
        title: "Seed Lockdown",
        description:
            "The contract is still ACTIVE. Bot uploads are closed, but the ceremony is still open so anyone can make the seed more random before play begins.",
    },
    [GameUiSubphase.PLAYING]: {
        contractPhase: GameContractPhase.ACTIVE,
        contractLabel: "ACTIVE",
        label: "Playing",
        title: "Playing",
        description:
            "The contract is still ACTIVE. The seed is fixed, and players can execute their bots and submit participations until the deadline.",
    },
    [GameUiSubphase.AWAITING_RESOLUTION]: {
        contractPhase: GameContractPhase.ACTIVE,
        contractLabel: "ACTIVE",
        label: "Awaiting Resolution",
        title: "Awaiting Resolution",
        description:
            "The contract is still ACTIVE. Participation is closed and the creator must reveal the secret before the grace period expires to enter RESOLUTION.",
    },
    [GameUiSubphase.SUSPENDED]: {
        contractPhase: GameContractPhase.ACTIVE,
        contractLabel: "ACTIVE",
        label: "Suspended",
        title: "Suspended",
        description:
            "The contract is still ACTIVE, but the creator missed the resolution window. Players can recover their funds and the game can no longer enter RESOLUTION.",
    },
    [GameUiSubphase.JUDGING]: {
        contractPhase: GameContractPhase.RESOLUTION,
        contractLabel: "RESOLUTION",
        label: "Judging",
        title: "Judging",
        description:
            "The contract is in RESOLUTION. The secret is revealed, scores are verifiable, and judges can validate or challenge the current winner candidate.",
    },
    [GameUiSubphase.READY_TO_FINALIZE]: {
        contractPhase: GameContractPhase.RESOLUTION,
        contractLabel: "RESOLUTION",
        label: "Ready to Finalize",
        title: "Ready to Finalize",
        description:
            "The contract is in RESOLUTION. The judge window is over and the game can be finalized so payouts are distributed.",
    },
    [GameUiSubphase.CANCELLED_LOCKED]: {
        contractPhase: GameContractPhase.CANCELLED,
        contractLabel: "CANCELLED_DRAINING",
        label: "Cancelled / Cooldown",
        title: "Cancelled / Cooldown",
        description:
            "The contract is in CANCELLED_DRAINING because the secret was revealed too early. Players can refund immediately and the next stake drain is still cooling down.",
    },
    [GameUiSubphase.CANCELLED_DRAINING]: {
        contractPhase: GameContractPhase.CANCELLED,
        contractLabel: "CANCELLED_DRAINING",
        label: "Cancelled / Draining",
        title: "Cancelled / Draining",
        description:
            "The contract is in CANCELLED_DRAINING because the secret was revealed too early. Players can refund immediately and the next stake drain is unlocked.",
    },
    [GameUiSubphase.FINALIZED]: {
        contractPhase: GameContractPhase.FINALIZED,
        contractLabel: "FINALIZED (derived)",
        label: "Finalized",
        title: "Finalized",
        description:
            "The game lifecycle ended and payouts were already distributed. FINALIZED is a derived frontend state, not a fourth on-chain contract state.",
    },
    [GameUiSubphase.UNKNOWN]: {
        contractPhase: GameContractPhase.UNKNOWN,
        contractLabel: "UNKNOWN",
        label: "Unknown",
        title: "Unknown",
        description: "The current contract phase could not be derived.",
    },
};

export function getSubphaseSequence(
    contractPhase: GameContractPhaseValue,
): GameUiSubphaseValue[] {
    switch (contractPhase) {
        case GameContractPhase.ACTIVE:
            return ACTIVE_SUBPHASE_SEQUENCE;
        case GameContractPhase.RESOLUTION:
            return RESOLUTION_SUBPHASE_SEQUENCE;
        case GameContractPhase.CANCELLED:
            return CANCELLATION_SUBPHASE_SEQUENCE;
        case GameContractPhase.FINALIZED:
            return FINALIZED_SUBPHASE_SEQUENCE;
        default:
            return [GameUiSubphase.UNKNOWN];
    }
}

export function deriveGamePhaseSnapshot(
    game: AnyGame | null,
    currentHeight: number,
): GamePhaseSnapshot {
    if (!game) {
        return {
            currentHeight,
            openCeremony: false,
            openSolverSubmit: false,
            participationIsEnded: false,
            resolutionAllowed: false,
            gameSuspended: false,
            subphase: GameUiSubphase.UNKNOWN,
            ...GAME_PHASE_DEFINITIONS[GameUiSubphase.UNKNOWN],
        };
    }

    const activeGame = game.status === GameState.Active ? game : null;
    const openCeremony =
        !!activeGame && currentHeight < activeGame.ceremonyDeadline;
    const openSolverSubmit =
        !!activeGame &&
        currentHeight <
            activeGame.ceremonyDeadline - activeGame.constants.SEED_MARGIN;
    const participationIsEnded =
        game.status !== GameState.Active || currentHeight >= game.deadlineBlock;
    const resolutionAllowed =
        game.status === GameState.Active &&
        currentHeight >= game.deadlineBlock &&
        currentHeight <
            game.deadlineBlock + game.constants.PARTICIPATION_GRACE_PERIOD;
    const gameSuspended =
        game.status === GameState.Active &&
        currentHeight >=
            game.deadlineBlock + game.constants.PARTICIPATION_GRACE_PERIOD;

    let subphase: GameUiSubphaseValue = GameUiSubphase.UNKNOWN;

    if (game.status === GameState.Finalized) {
        subphase = GameUiSubphase.FINALIZED;
    } else if (game.status === GameState.Cancelled_Draining) {
        subphase =
            currentHeight >= game.unlockHeight
                ? GameUiSubphase.CANCELLED_DRAINING
                : GameUiSubphase.CANCELLED_LOCKED;
    } else if (game.status === GameState.Resolution) {
        subphase =
            currentHeight >= game.resolutionDeadline
                ? GameUiSubphase.READY_TO_FINALIZE
                : GameUiSubphase.JUDGING;
    } else if (game.status === GameState.Active) {
        if (gameSuspended) {
            subphase = GameUiSubphase.SUSPENDED;
        } else if (participationIsEnded) {
            subphase = GameUiSubphase.AWAITING_RESOLUTION;
        } else if (openCeremony && openSolverSubmit) {
            subphase = GameUiSubphase.STRATEGY_UPLOAD;
        } else if (openCeremony) {
            subphase = GameUiSubphase.SEED_LOCKDOWN;
        } else {
            subphase = GameUiSubphase.PLAYING;
        }
    }

    return {
        currentHeight,
        openCeremony,
        openSolverSubmit,
        participationIsEnded,
        resolutionAllowed,
        gameSuspended,
        subphase,
        ...GAME_PHASE_DEFINITIONS[subphase],
    };
}
