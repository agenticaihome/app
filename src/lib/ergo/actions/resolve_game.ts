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
import { get } from 'svelte/store';
import { explorer_uri } from '../envs';

declare const ergo: any;

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
 * Inicia la transición de un juego del estado Activo al de Resolución (Refactorizado).
 */
export async function resolve_game(
    game: GameActive,
    participations: ValidParticipation[],
    secretS_hex: string,
    judgeProofs: string[]
): Promise<string | null> {

    const JUDGE_PERIOD = getGameConstants().JUDGE_PERIOD + 10;

    console.log(`Iniciando transición a resolución para el juego: ${game.boxId}`);

    // Fetch Config Box to verify and use as DataInput
    if (!game.configBoxId) {
        throw new Error("Game Active Box does not have a configBoxId. Is it using the old contract?");
    }
    const configBox = await fetchBox(game.configBoxId);
    if (!configBox) throw new Error(`Could not fetch Config Box: ${game.configBoxId}`);

    const dataMap = await fetchJudges();
    const judgeProofBoxes: Box<Amount>[] = judgeProofs.flatMap(key => {
        const judge = dataMap.get(key);
        if (!judge) { return []; }
        const boxWrapper = judge.current_boxes.find(box => box.type.tokenId == GAME && box.object_pointer === game.gameId);
        return boxWrapper ? [boxWrapper.box] : [];
    });

    if (!Array.isArray(participations)) {
        throw new Error("El listado de participaciones proporcionado es inválido.");
    }
    const currentHeight = await ergo.get_current_height();
    if (currentHeight < game.deadlineBlock) {
        throw new Error("El juego no puede ser resuelto antes de su fecha límite.");
    }

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Formato de secretS_hex inválido.");

    const hash_of_provided_secret = fleetBlake2b256(secretS_bytes);
    if (uint8ArrayToHex(hash_of_provided_secret) !== game.secretHash) {
        throw new Error("El secreto proporcionado no coincide con el hash del juego.");
    }

    const resolverAddressString = await ergo.get_change_address();
    const resolverP2pk = ErgoAddress.fromBase58(resolverAddressString);
    const resolverPkBytes = resolverP2pk.getPublicKeys()[0];

    // Verify Judges Tokens (Check against Config Box or Game Object which is hydrated)
    const invitedJudgesTokens = [...game.judges].sort();
    const participatingJudgesTokens = judgeProofBoxes.map(box => box.assets[0].tokenId).sort();

    // Note: If judge proofs are not required/checked by contract in this step, strictly optional.
    // The contract requires R7 to contain the judge tokens. 
    // And actually, this action DOES NOT require dataInputs for judges in the transition from Active -> Resolution?
    // Let's check `game_active.es`.
    // It checks `resolutionBox.R7` matches `invitedJudges`.
    // It DOES NOT check judge inputs relative to active box spending.
    // BUT `resolve_game` seems to fetch them to include them as DataInputs?
    // In `game_active.es`, there is no validation of DataInputs for judges.
    // The previous code included them. Maybe for context or consistency.
    // I will keep logic but if `participatingJudgesTokens` is empty, it's fine if the game has no judges?
    // `game.judges` comes from config.

    if (JSON.stringify(invitedJudgesTokens) !== JSON.stringify(participatingJudgesTokens)) {
        // This check forces the resolver to provide proofs for ALL invited judges.
        // If this is desired behavior, keep it. If not (e.g. judges can be absent?), remove strict equality.
        // Assuming strict for now as per original code.
        throw new Error("Los tokens de prueba de los jueces no coinciden con los jueces invitados en el contrato.");
    }

    // --- 2. Determinar el ganador y filtrar participaciones (lógica off-chain) ---
    // ... (This logic remains largely checking participation validity)
    let maxScore = -1n;
    let winnerCandidateCommitment: string | null = null;
    let winnerCandidateBox: Box<Amount> | null = null;
    let winnerCandidateSolverIdBox: Box<Amount> | null = null;

    const participationErgoTree = getGopParticipationErgoTreeHex();
    const participationErgoTreeBytes = hexToBytes(participationErgoTree);
    if (!participationErgoTreeBytes) throw new Error("El ErgoTree del script de participación es inválido.");

    const participationScriptHash = uint8ArrayToHex(fleetBlake2b256(participationErgoTreeBytes));

    for (const p of participations) {
        const pBox = parseBox(p.box);
        if (uint8ArrayToHex(fleetBlake2b256(hexToBytes(pBox.ergoTree) ?? "")) !== participationScriptHash) continue;
        if (p.gameNftId !== game.box.assets[0].tokenId) continue;
        if (BigInt(pBox.value) < game.participationFeeAmount) continue;

        let actualScore = resolve_participation_commitment(p, secretS_hex, game.seed);
        if (actualScore === null) continue;

        const pBoxCreationHeight = pBox.creationHeight;
        const effectiveScore = calculateEffectiveScore(game, actualScore, p.solverIdBox?.creationHeight ?? 0);

        if (effectiveScore > maxScore || (effectiveScore === maxScore && pBoxCreationHeight < (winnerCandidateBox ? parseBox(winnerCandidateBox).creationHeight : Infinity))) {
            maxScore = effectiveScore;
            winnerCandidateCommitment = p.commitmentC_Hex;
            winnerCandidateBox = p.box;
            winnerCandidateSolverIdBox = p.solverIdBox;
        }
    }

    console.log(`Ganador candidato determinado con compromiso: ${winnerCandidateCommitment} y puntuación: ${maxScore}`);

    // --- 3. Construir las Salidas de la Transacción ---

    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();
    const resolutionDeadline = BigInt(currentHeight + JUDGE_PERIOD);

    // Prepare Registers for Resolution Box (Refactored)
    // R4: State (1)
    const r4Hex = SInt(1).toHex();

    // R5: Seed
    const seedBytes = hexToBytes(game.seed);
    if (!seedBytes) throw new Error("Invalid seed bytes");
    const r5Hex = SColl(SByte, seedBytes).toHex();

    // R6: (secretS, winnerCommitment)
    let winnerCommitmentBytes = new Uint8Array();
    if (winnerCandidateCommitment) {
        winnerCommitmentBytes = hexToBytes(winnerCandidateCommitment) || new Uint8Array();
    }
    const r6Hex = SPair(SColl(SByte, secretS_bytes), SColl(SByte, winnerCommitmentBytes)).toHex();

    // R7: [resolutionDeadline, perJudgeCommission, resolverCommission]
    // Note: perJudgeCommission and resolverCommission are percentages/fractions stored as Longs. 
    // We use the values from the game object.
    const r7Hex = SColl(SLong, [
        resolutionDeadline,
        BigInt(game.perJudgeCommissionPercentage),
        BigInt(game.commissionPercentage)
    ]).toHex();

    // R8: resolverPK
    const r8Hex = SColl(SByte, resolverPkBytes).toHex();

    // R9: configBoxId
    const configBoxIdBytes = hexToBytes(game.configBoxId);
    if (!configBoxIdBytes) throw new Error("Invalid configBoxId bytes");
    const r9Hex = SColl(SByte, configBoxIdBytes).toHex();

    const boxCandidate = {
        transactionId: "00".repeat(32),
        index: 0,
        value: SAFE_MIN_BOX_VALUE,
        ergoTree: resolutionErgoTree,
        creationHeight: currentHeight,
        assets: game.box.assets,
        additionalRegisters: {
            R4: r4Hex, R5: r5Hex, R6: r6Hex, R7: r7Hex, R8: r8Hex, R9: r9Hex
        }
    };

    let boxSize = serializeBox(boxCandidate).length;

    const minRequiredValue = BigInt(boxSize) * BOX_VALUE_PER_BYTE;
    const originalValue = BigInt(game.box.value);
    const resolutionBoxValue = (originalValue > minRequiredValue) ? originalValue : minRequiredValue;
    const finalResolutionBoxValue = (resolutionBoxValue > BigInt(SAFE_MIN_BOX_VALUE)) ? resolutionBoxValue : BigInt(SAFE_MIN_BOX_VALUE);

    const resolutionBoxOutput = new OutputBuilder(finalResolutionBoxValue, resolutionErgoTree)
        .addTokens(game.box.assets)
        .setAdditionalRegisters({
            R4: r4Hex, R5: r5Hex, R6: r6Hex, R7: r7Hex, R8: r8Hex, R9: r9Hex
        });

    // --- 4. Construir y Enviar la Transacción ---    

    // Data Inputs: Judge Proofs + Config Box
    let dataInputs = [configBox, ...judgeProofBoxes];

    // Actually, judge proofs are not strictly required by verification here, but ok to include.
    // If winner found, include them too?
    if (winnerCandidateBox) {
        if (!winnerCandidateSolverIdBox) throw new Error("Missing solver box");
        dataInputs.push(winnerCandidateBox);
        dataInputs.push(winnerCandidateSolverIdBox);
    }

    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from([parseBox(game.box), ...await ergo.get_utxos()])
            .to([resolutionBoxOutput])
            .sendChangeTo(resolverAddressString)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .withDataFrom(dataInputs)
            .build();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Transición a resolución enviada con éxito. ID de la transacción: ${txId}`);
        return txId;

    } catch (error) {
        console.error("Error al construir o enviar la transacción:", error);
        throw error;
    }
}