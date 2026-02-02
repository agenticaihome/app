import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { getGopGameResolutionErgoTreeHex } from '../contract';
import { prependHexPrefix } from '$lib/utils';
import { stringToBytes } from '@scure/base';
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
 * Permite a cualquier usuario incluir una participación que fue omitida
 * durante la transición inicial a la fase de Resolución.
 */
export async function include_omitted_participation(
    game: GameResolution,
    omittedParticipation: ValidParticipation,
    currentWinnerParticipation: ValidParticipation | null,
    newResolverPkHex: string
): Promise<string | null> {

    console.log(`Intentando incluir la participación omitida ${omittedParticipation.boxId} en el juego: ${game.boxId}`);

    if (!game.configBoxId) throw new Error("Game is missing configBoxId");
    const configBox = await fetchBox(game.configBoxId);
    if (!configBox) throw new Error("Could not fetch Config Box");

    // --- 1. Verificaciones preliminares ---
    const currentHeight = await ergo.get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("No se pueden incluir participaciones después de que finalice el período de los jueces.");
    }

    // Check penalization
    const penalizationThreshold = game.resolutionDeadline - game.constants.JUDGE_PERIOD + game.constants.RESOLVER_OMISSION_NO_PENALTY_PERIOD;
    const isPenalized = currentHeight > penalizationThreshold;
    const activeResolverPkBytes = (isPenalized && newResolverPkHex) ? hexToBytes(newResolverPkHex)! : hexToBytes(game.resolverPK_Hex)!;

    if (!activeResolverPkBytes) throw new Error("Could not determine active resolver PK bytes");

    // --- 3. Construir las Salidas de la Transacción ---

    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();

    const recreatedGameBox = new OutputBuilder(
        BigInt(game.box.value),
        resolutionErgoTree
    )
        .addTokens(game.box.assets)
        .setAdditionalRegisters({
            R4: SInt(1).toHex(), // Preservar estado (1: Resolved)

            // R5: Seed
            R5: SColl(SByte, hexToBytes(game.seed)!).toHex(),

            // --- R6: (revealedSecretS, winnerCandidateCommitment) ---
            R6: SPair(
                SColl(SByte, hexToBytes(game.revealedS_Hex)!),
                SColl(SByte, hexToBytes(omittedParticipation.commitmentC_Hex)!)
            ).toHex(),

            // --- R7: [resolutionDeadline, perJudgeCommission, resolverCommission] ---
            R7: SColl(SLong, [
                BigInt(game.resolutionDeadline),
                BigInt(game.perJudgeCommissionPercentage),
                BigInt(game.resolverCommission)
            ]).toHex(),

            // --- R8: resolverPK ---
            R8: SColl(SByte, activeResolverPkBytes).toHex(),

            // --- R9: configBoxId ---
            R9: SColl(SByte, hexToBytes(game.configBoxId)!).toHex()
        });

    const pBox = parseBox(omittedParticipation.box);

    // --- 4. Construir y Enviar la Transacción ---
    const userAddress = pkHexToBase58Address(newResolverPkHex);
    const utxos: Box<any>[] = await ergo.get_utxos();

    const inputs = [parseBox(game.box), ...utxos];
    if (!omittedParticipation.solverIdBox) {
        throw new Error("Omitted participation does not have a solver ID box.");
    }
    const solverIdBox = omittedParticipation.solverIdBox;

    const dataInputs = [configBox, pBox, solverIdBox];
    if (currentWinnerParticipation) {
        dataInputs.push(parseBox(currentWinnerParticipation.box));
    }

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([recreatedGameBox])
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Transacción para incluir participación omitida enviada. ID: ${txId}`);
    return txId;
}
