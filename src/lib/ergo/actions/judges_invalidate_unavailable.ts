import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { getGopGameResolutionErgoTreeHex } from '../contract';
import { get } from 'svelte/store';
import { explorer_uri } from '../envs';
declare const ergo: any;
const JUDGE_PERIOD_MARGIN = 10;

async function fetchBox(boxId: string): Promise<Box<Amount> | null> {
    try {
        const res = await fetch(`${get(explorer_uri)}/api/v1/boxes/${boxId}`);
        if (res.ok) return await res.json();
        return null;
    } catch (e) {
        console.error("Error fetching box:", e);
        return null;
    }
}

/**
 * Allows a judge (or group of judges) to mark the current winner as unavailable.
 * This is similar to invalidation but does not penalize the resolver.
 */
export async function judges_invalidate_unavailable(
    game: GameResolution,
    invalidatedParticipation: ValidParticipation,
    judgeVoteDataInputs: Box<Amount>[]
): Promise<string | null> {

    console.log(`Initiating candidate unavailable marking for the game: ${game.boxId}`);

    if (!game.configBoxId) throw new Error("Game is missing configBoxId");
    const configBox = await fetchBox(game.configBoxId);
    if (!configBox) throw new Error("Could not fetch Config Box");

    // --- 1. Preliminary checks ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("Unavailable marking is only possible before the judges' period ends.");
    }

    // Verify that the provided participation is indeed that of the current winning candidate
    if (invalidatedParticipation.commitmentC_Hex !== game.winnerCandidateCommitment) {
        throw new Error("The provided participation does not correspond to the current winning candidate of the game.");
    }

    // Check all judge votes - they should be for PARTICIPATION_UNAVAILABLE_TYPE_ID
    for (const p of judgeVoteDataInputs) {
        const reg = p.additionalRegisters;
        const valid = reg.R4 === "0e20" + game.constants.PARTICIPATION_UNAVAILABLE_TYPE_ID &&
            reg.R5 === "0e20" + game.winnerCandidateCommitment;

        if (!valid) {
            console.log(reg.R4)
            console.log(reg.R5)
            throw new Error("Invalid judge vote for unavailable marking.")
        }
    }

    const requiredVotes = Math.floor(game.judges.length / 2) + 1;
    if (judgeVoteDataInputs.length < requiredVotes) {
        throw new Error(`Required ${requiredVotes} judge votes, but only ${judgeVoteDataInputs.length} were provided.`);
    }

    // --- 3. Prepare data for the new resolution box ---

    const dataInputs = [
        configBox,
        ...judgeVoteDataInputs
    ];

    const newGameBoxValue = BigInt(game.box.value) + BigInt(invalidatedParticipation.box.value);

    // Calculate new Token Balances if applicable
    const gameTokens = [game.box.assets[0]]; // NFT
    if (game.participationTokenId !== "") {
        const currentAmount = BigInt(game.box.assets.find(t => t.tokenId === game.participationTokenId)?.amount || 0n);
        const invalidatedAmount = BigInt(invalidatedParticipation.box.assets.find(t => t.tokenId === game.participationTokenId)?.amount || 0n);
        gameTokens.push({ tokenId: game.participationTokenId, amount: currentAmount + invalidatedAmount });
    }

    const newDeadline = BigInt(currentHeight + game.constants.JUDGE_PERIOD + JUDGE_PERIOD_MARGIN);
    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();

    // R7 values (No penalty)
    const newJudgeComm = BigInt(game.perJudgeCommissionPercentage);
    const newResolverComm = BigInt(game.resolverCommission);

    // --- 4. Build the new resolution box ---
    const recreatedGameBox = new OutputBuilder(newGameBoxValue, resolutionErgoTree)
        .addTokens(gameTokens) // Updated tokens list
        .setAdditionalRegisters({
            R4: SInt(1).toHex(),
            R5: SColl(SByte, hexToBytes(game.seed)!).toHex(),
            R6: SPair(
                SColl(SByte, hexToBytes(game.revealedS_Hex)!),
                SColl(SByte, []) // Empty commitment
            ).toHex(),
            R7: SColl(SLong, [
                newDeadline,
                newJudgeComm,
                newResolverComm
            ]).toHex(),
            R8: SColl(SByte, hexToBytes(game.resolverPK_Hex)!).toHex(),
            R9: SColl(SByte, hexToBytes(game.configBoxId)!).toHex(),
        });

    // --- 5. Build and Submit the Transaction ---
    const userAddress = await ergo.get_change_address();
    const utxos: Box<Amount>[] = await ergo.get_utxos();

    const inputs = [parseBox(game.box), parseBox(invalidatedParticipation.box), ...utxos];

    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(inputs)
            .to(recreatedGameBox)
            .withDataFrom(dataInputs)
            .sendChangeTo(userAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();


        const signedTransaction = await Promise.race([
            ergo.sign_tx(unsignedTransaction.toEIP12Object()),
            new Promise((_, reject) => setTimeout(() => reject(new Error("sign_tx timeout")), 15000))
        ]);


        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Candidate unavailable marking transaction successfully submitted. ID: ${txId}`);
        return txId;
    } catch (error) {
        console.warn(error)
        throw error;
    }
}