import {
    OutputBuilder,
    TransactionBuilder,
    ErgoAddress,
    type Box,
    RECOMMENDED_MIN_FEE_VALUE,
    type Amount,
    BOX_VALUE_PER_BYTE,
    SAFE_MIN_BOX_VALUE
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt, serializeBox } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { resolve_participation_commitment, calculateEffectiveScore, type GameActive, type ValidParticipation } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameResolutionErgoTreeHex, getGopParticipationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { GAME } from '../reputation/types';
import { fetchJudges } from '../reputation/fetch';

import { prependHexPrefix } from '$lib/utils';
import { getGameConstants } from '$lib/common/constants';
import { ErgoPlatform } from '../platform';

declare const ergo: any;

// Constant for game_resolution.es contract
// Moved inside function to be dynamic

/**
 * Initiates the transition of a game from the Active state to Resolution.
 * This action consumes the game box and all valid participations,
 * and creates a new 'GameResolution' box and 'Participation' boxes.
 * @param game The GameActive object to resolve.
 * @param participations An array of all submitted participations (Participation).
 * @param secretS_hex The 'S' secret in hexadecimal format to reveal to the winner.
 * @param judgeProofs An array of the judges' reputation proof keys, which will be used to fetch data inputs.
 * @returns The transaction ID if successful.
 */
export async function resolve_game(
    game: GameActive,
    participations: ValidParticipation[],
    secretS_hex: string,
    judgeProofs: string[]
): Promise<string | null> {

    const JUDGE_PERIOD = getGameConstants().JUDGE_PERIOD + 10;

    console.log(`Starting resolution transition for game: ${game.boxId}`);

    const dataMap = await fetchJudges();
    const judgeProofBoxes: Box<Amount>[] = judgeProofs.flatMap(key => {
        const judge = dataMap.get(key);
        if (!judge) { return []; }
        const boxWrapper = judge.current_boxes.find(box => box.type.tokenId == GAME && box.object_pointer === game.gameId);
        return boxWrapper ? [boxWrapper.box] : [];
    });

    if (!Array.isArray(participations)) {
        throw new Error("The provided participation list is invalid.");
    }
    const currentHeight = await (new ErgoPlatform()).get_current_height();
    if (currentHeight < game.deadlineBlock) {
        throw new Error("The game cannot be resolved before its deadline.");
    }

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Invalid secretS_hex format.");

    const hash_of_provided_secret = fleetBlake2b256(secretS_bytes);
    if (uint8ArrayToHex(hash_of_provided_secret) !== game.secretHash) {
        throw new Error("The provided secret does not match the game hash.");
    }

    const resolverAddressString = await ergo.get_change_address();
    const resolverPkBytes = ErgoAddress.fromBase58(resolverAddressString).getPublicKeys()[0];

    if (!Array.isArray(judgeProofBoxes)) {
        throw new Error("The provided judges' proof boxes list is invalid.");
    }
    if (game.judges.length !== judgeProofBoxes.length) {
        throw new Error(`Expected ${game.judges.length} judge proof(s), but received ${judgeProofBoxes.length}.`);
    }

    const invitedJudgesTokens = [...game.judges].sort();
    const participatingJudgesTokens = judgeProofBoxes.map(box => box.assets[0].tokenId).sort();

    if (JSON.stringify(invitedJudgesTokens) !== JSON.stringify(participatingJudgesTokens)) {
        throw new Error("The judges' proof tokens do not match the judges invited in the contract.");
    }

    // Verify all judge R9 commitments before proceeding (off-chain validation matching on-chain condition)
    for (const judgeBox of judgeProofBoxes) {
        const r9 = judgeBox.additionalRegisters.R9;
        if (!r9) {
            throw new Error(`Judge box ${judgeBox.boxId} is missing R9 data.`);
        }

        try {
            if (typeof r9 !== "string" || r9.length < 10) {
                throw new Error("Invalid R9 format");
            }

            // R9: Coll[Coll[Byte]] = [commitmentBytes, preimageBytes]
            const r9Value = SConstant.fromHex(r9).data as unknown;
            if (!Array.isArray(r9Value) || r9Value.length !== 2) {
                throw new Error("Invalid R9 structure");
            }

            const [commitmentBytes, preimageBytes] = r9Value;
            if (!(commitmentBytes instanceof Uint8Array) || !(preimageBytes instanceof Uint8Array)) {
                throw new Error("Invalid R9 payload types");
            }

            const hashInput = new Uint8Array(preimageBytes.length + secretS_bytes.length);
            hashInput.set(preimageBytes, 0);
            hashInput.set(secretS_bytes, preimageBytes.length);

            const computedCommitment = fleetBlake2b256(hashInput);
            if (uint8ArrayToHex(computedCommitment) !== uint8ArrayToHex(commitmentBytes)) {
                throw new Error("R9 commitment mismatch");
            }
        } catch (e) {
            throw new Error(`Judge box ${judgeBox.boxId} has invalid R9 commitment data execution.`);
        }
    }

    // --- 2. Determine the winner and filter participations (off-chain logic) ---
    let maxScore = -1n;
    let winnerCandidateCommitment: string | null = null;
    let winnerCandidateBox: Box<Amount> | null = null;
    let winnerCandidateSolverIdBox: Box<Amount> | null = null;

    const participationErgoTree = getGopParticipationErgoTreeHex();
    const participationErgoTreeBytes = hexToBytes(participationErgoTree);
    if (!participationErgoTreeBytes) {
        throw new Error("The participation script ErgoTree is invalid.");
    }
    const participationScriptHash = uint8ArrayToHex(fleetBlake2b256(participationErgoTreeBytes));


    for (const p of participations) {
        const pBox = parseBox(p.box);

        // Verification 1: Correct Participation Script
        if (uint8ArrayToHex(fleetBlake2b256(hexToBytes(pBox.ergoTree) ?? "")) !== participationScriptHash) {
            console.warn(`Participation ${p.boxId} has an incorrect script. It will be skipped.`);
            continue;
        }

        // Verification 2: Reference to the Game NFT
        if (p.gameNftId !== game.box.assets[0].tokenId) {
            console.warn(`Participation ${p.boxId} does not point to this game's NFT. It will be skipped.`);
            continue;
        }

        // Verification 3: Participation Fee Payment
        if (BigInt(pBox.value) < game.participationFeeAmount) {
            console.warn(`Participation ${p.boxId} does not meet the minimum fee. It will be skipped.`);
            continue;
        }

        // Score validation simulation
        let actualScore = resolve_participation_commitment(p, secretS_hex, game.seed);

        if (actualScore === null) {
            console.warn(`Could not find a valid score for participation ${p.commitmentC_Hex}. It will be skipped.`);
            continue;
        }

        const pBoxCreationHeight = pBox.creationHeight;

        const effectiveScore = calculateEffectiveScore(game, actualScore, p.solverIdBox?.creationHeight ?? 0);

        if (effectiveScore > maxScore || (effectiveScore === maxScore && pBoxCreationHeight < (winnerCandidateBox ? parseBox(winnerCandidateBox).creationHeight : Infinity))) {
            maxScore = effectiveScore;
            winnerCandidateCommitment = p.commitmentC_Hex;
            winnerCandidateBox = p.box;
            winnerCandidateSolverIdBox = p.solverIdBox;
        }
    }

    console.log(`Candidate winner determined with commitment: ${winnerCandidateCommitment} and score: ${maxScore}`);

    // --- 3. Build Transaction Outputs ---

    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const resolutionDeadline = BigInt(currentHeight + JUDGE_PERIOD);
    const devScriptBytes = hexToBytes(game.devScript);
    if (!devScriptBytes) throw new Error("Invalid DEV_SCRIPT on game object");

    const newNumericalParams = [
        BigInt(game.createdAt),
        game.timeWeight,
        BigInt(game.deadlineBlock),
        game.resolverStakeAmount,
        game.participationFeeAmount,
        game.perJudgeCommission,
        BigInt(game.resolverCommission),
        BigInt(game.devCommission),
        resolutionDeadline
    ];

    let winnerCommitmentBytes: Uint8Array;
    if (winnerCandidateCommitment) {
        const bytes = hexToBytes(winnerCandidateCommitment);
        if (!bytes) throw new Error("Failed to convert commitmentC to bytes.");
        winnerCommitmentBytes = bytes;
    }
    else {
        winnerCommitmentBytes = new Uint8Array();
    }
    // max for BigInt
    const maxBigInt = (...vals: bigint[]) => vals.reduce((a, b) => a > b ? a : b, vals[0]);

    const seedBytes = hexToBytes(game.seed);
    if (!seedBytes) throw new Error("Could not get the 'seed' from the game object (game.seedHex).");

    const gameDetailsBytes = stringToBytes('utf8', game.content.rawJsonString);

    const r4Hex = SInt(1).toHex(); // R4: Estado (1: Resuelto)
    const r5Hex = SColl(SByte, seedBytes).toHex(); // R5: Seed
    const r6Hex = SPair(SColl(SByte, secretS_bytes), SColl(SByte, winnerCommitmentBytes)).toHex(); // R6: (secretS, winnerCommitment)
    const r7Hex = SColl(SColl(SByte), participatingJudgesTokens.map(t => hexToBytes(t)!)).toHex(); // R7: Jueces participantes
    const r8Hex = SColl(SLong, newNumericalParams).toHex(); // R8: Parámetros numéricos

    const r9Hex = SColl(SColl(SByte), [gameDetailsBytes, hexToBytes(game.participationTokenId) ?? "", devScriptBytes, prependHexPrefix(resolverPkBytes)]).toHex();

    const boxCandidate = {
        transactionId: "00".repeat(32),
        index: 0,
        value: SAFE_MIN_BOX_VALUE,
        ergoTree: resolutionErgoTree,
        creationHeight: currentHeight,
        assets: game.box.assets,
        additionalRegisters: {
            R4: r4Hex,
            R5: r5Hex,
            R6: r6Hex,
            R7: r7Hex,
            R8: r8Hex,
            R9: r9Hex
        }
    };

    let boxSize = 0;
    try {
        const serialized = serializeBox(boxCandidate);
        boxSize = serialized.length;
        console.log("REAL resolution box size:", boxSize);
    } catch (e) {
        console.error("Error serializing resolution box:", e);
        throw new Error("Failed to serialize the resolution box. It might be too large or invalid.");
    }

    if (boxSize > 4096) {
        throw new Error(`The resolution box size (${boxSize} bytes) exceeds the maximum allowed size of 4096 bytes.`);
    }

    const minRequiredValue = BigInt(boxSize) * BOX_VALUE_PER_BYTE;

    // current box value (ensure it's BigInt)
    const originalValue = BigInt(game.box.value);

    // select the maximum between originalValue, minRequiredValue, and SAFE_MIN_BOX_VALUE
    const resolutionBoxValue = maxBigInt(originalValue, minRequiredValue, SAFE_MIN_BOX_VALUE);

    const resolutionBoxOutput = new OutputBuilder(
        resolutionBoxValue,
        resolutionErgoTree
    )
        .addTokens(game.box.assets)
        .setAdditionalRegisters({
            R4: r4Hex,
            R5: r5Hex,
            R6: r6Hex,
            R7: r7Hex,
            R8: r8Hex,
            R9: r9Hex
        });

    // --- 4. Build and Send the Transaction ---    

    let dataInputs = judgeProofBoxes;
    if (winnerCandidateBox) {
        if (!winnerCandidateSolverIdBox) {
            throw new Error("Winner candidate selected but no solver ID box found.");
        }
        dataInputs = [...judgeProofBoxes, winnerCandidateBox, winnerCandidateSolverIdBox];
    }

    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(parseBox(game.box), { ensureInclusion: true })
            .and.from(await ergo.get_utxos())
            .to([resolutionBoxOutput])
            .sendChangeTo(resolverAddressString)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .withDataFrom(dataInputs)
            .build();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Resolution transition sent successfully. Transaction ID: ${txId}`);
        return txId;

    } catch (error) {
        console.error("Error building or sending the transaction:", error);
        throw error;
    }
}
