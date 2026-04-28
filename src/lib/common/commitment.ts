import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import {
    bigintToLongByteArray,
    hexToBytes,
    uint8ArrayToHex,
} from "$lib/ergo/utils";

export interface CommitmentValidationResult {
    isValid: boolean;
    matchedScore: bigint | null;
    expectedCommitmentHex: string | null;
    computedCommitmentHex: string | null;
    reason: string;
}

/**
 * Compute the commitment hex using the same canonical ordering used on-chain.
 * Returns a lowercase hex string or null on invalid input.
 */
export function computeCommitmentHex(
    solverIdHex: string,
    seedHex: string,
    score: bigint,
    hashLogsHex: string,
    ergoTreeHex: string,
    secretHex: string,
): string | null {
    const solverIdBytes = hexToBytes(solverIdHex);
    const seedBytes = hexToBytes(seedHex);
    const hashLogsBytes = hexToBytes(hashLogsHex);
    const ergoTreeBytes = hexToBytes(ergoTreeHex);
    const secretBytes = hexToBytes(secretHex);

    if (!solverIdBytes || !seedBytes || !hashLogsBytes || !ergoTreeBytes || !secretBytes) {
        return null;
    }

    const scoreBytes = bigintToLongByteArray(score);

    const dataToHash = new Uint8Array([
        ...solverIdBytes,
        ...seedBytes,
        ...scoreBytes,
        ...hashLogsBytes,
        ...ergoTreeBytes,
        ...secretBytes,
    ]);

    return uint8ArrayToHex(fleetBlake2b256(dataToHash));
}

/**
 * Given the declared commitment and input pieces, traverse the score list and
 * return whether any score reproduces the declared commitment.
 */
export function findMatchingScoreForCommitment(params: {
    declaredCommitmentHex?: string | null;
    solverIdHex?: string | null;
    seedHex?: string | null;
    scoreList?: bigint[] | null;
    hashLogsHex?: string | null;
    ergoTreeHex?: string | null;
    secretHex?: string | null;
}): CommitmentValidationResult {
    const {
        declaredCommitmentHex,
        solverIdHex,
        seedHex,
        scoreList,
        hashLogsHex,
        ergoTreeHex,
        secretHex,
    } = params;

    if (!declaredCommitmentHex) {
        return {
            isValid: false,
            matchedScore: null,
            expectedCommitmentHex: null,
            computedCommitmentHex: null,
            reason: "missing_declared_commitment",
        };
    }

    if (!solverIdHex || !seedHex || !hashLogsHex || !ergoTreeHex || !secretHex) {
        return {
            isValid: false,
            matchedScore: null,
            expectedCommitmentHex: declaredCommitmentHex,
            computedCommitmentHex: null,
            reason: "incomplete",
        };
    }

    if (!scoreList || !Array.isArray(scoreList) || scoreList.length === 0) {
        return {
            isValid: false,
            matchedScore: null,
            expectedCommitmentHex: declaredCommitmentHex,
            computedCommitmentHex: null,
            reason: "empty_scores",
        };
    }

    const expected = declaredCommitmentHex.toLowerCase();

    for (const score of scoreList) {
        const computed = computeCommitmentHex(
            solverIdHex,
            seedHex,
            score,
            hashLogsHex,
            ergoTreeHex,
            secretHex,
        );
        if (computed === null) {
            return {
                isValid: false,
                matchedScore: null,
                expectedCommitmentHex: declaredCommitmentHex,
                computedCommitmentHex: null,
                reason: "invalid_hex",
            };
        }

        if (computed.toLowerCase() === expected) {
            return {
                isValid: true,
                matchedScore: score,
                expectedCommitmentHex: declaredCommitmentHex,
                computedCommitmentHex: computed,
                reason: "matched",
            };
        }
    }

    return {
        isValid: false,
        matchedScore: null,
        expectedCommitmentHex: declaredCommitmentHex,
        computedCommitmentHex: null,
        reason: "no_match",
    };
}
