import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    SConstant
} from '@fleet-sdk/core';
import { SColl, SByte, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { type GameActive } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameCancellationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
declare const ergo: any;
import { getGameConstants } from '$lib/common/constants';

// --- Constantes del contrato game_cancellation.es ---
// Note: Constants should be imported from constants file if possible
const STAKE_DENOMINATOR = 5n; // Usar BigInt para consistencia
const COOLDOWN_IN_BLOCKS = 40; // Cooldown base definido en el contrato

/**
 * Inicia la cancelación de un juego activo (Refactorizado).
 */
export async function cancel_game(
    game: GameActive,
    secretS_hex: string,
    claimerAddressString: string
): Promise<string | null> {

    const maxBigInt = (a: bigint, b: bigint): bigint => (a > b ? a : b);

    console.warn(`Iniciando transición de cancelación para el juego: ${game.boxId}`);

    // --- 1. Obtener datos y realizar pre-chequeos ---
    const currentHeight = await ergo.get_current_height();

    if (currentHeight >= game.deadlineBlock) {
        throw new Error("La cancelación del juego solo es posible antes de la fecha límite.");
    }

    const gameBoxToSpend = game.box;
    if (!gameBoxToSpend) throw new Error("Los datos de la GameBox no se encuentran en el objeto del juego.");

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Formato de secretS_hex inválido.");

    // Verificar que el secreto proporcionado coincide con el hash en la caja activa.
    const hash_of_provided_secret = fleetBlake2b256(secretS_bytes);
    if (uint8ArrayToHex(hash_of_provided_secret) !== game.secretHash) {
        throw new Error("El secreto proporcionado no coincide con el hash en la GameBox.");
    }

    if (!game.configBoxId) {
        throw new Error("Game is missing configBoxId. Cannot cancel.");
    }

    // --- 2. Calcular valores para la nueva caja de cancelación y la penalización ---
    const constants = getGameConstants();
    const stakeDenominator = BigInt(constants.STAKE_DENOMINATOR);
    const cooldown = BigInt(constants.COOLDOWN_IN_BLOCKS);

    let stakePortionToClaim = game.resolverStakeAmount / stakeDenominator;
    const newValue = BigInt(game.box.value) - stakePortionToClaim; // Assuming value logic logic holds

    const gameTokens = [{
        tokenId: game.participationTokenId,
        amount: newValue // This assumes the token amount tracks value. Verify logic.
        // Usually participationTokenId amount == value if it's the tracking token.
        // If participationTokenId is distinct from ERG value logic, check.
        // In previous code: `amount: newValue`. So yes.
    }];

    // --- 3. Construir Salidas de la Transacción ---

    // La dirección/ErgoTree de la nueva caja será la del script de cancelación.
    const cancellationContractErgoTree = getGopGameCancellationErgoTreeHex();
    const newUnlockHeight = BigInt(currentHeight + Number(cooldown));

    const configBoxIdBytes = hexToBytes(game.configBoxId);
    if (!configBoxIdBytes) throw new Error("Invalid configBoxId bytes");

    // SALIDA(0): La nueva caja de cancelación (`game_cancellation.es`)
    const cancellationBoxOutput = new OutputBuilder(
        newValue, // Use calculated remaining value
        cancellationContractErgoTree
    )
        .addTokens([gameBoxToSpend.assets[0]]) // Preservar el NFT del juego.
    // .addTokens([...gameTokens]) // Previous code added tokens. Fleet handles merging/splitting?
    // Fleet addTokens adds to the list.
    // Important: input assets must balance output assets.
    // Input has NFT + participationTokens.
    // Penalty Output gets some participationTokens?
    // Previous code:
    // Cancellation Box: NFT + (Total - Penalty) tokens.
    // Claimer Box: Penalty tokens.
    // Total balanced.

    if (gameTokens.length > 0 && gameTokens[0].amount > 0n) {
        cancellationBoxOutput.addTokens(gameTokens);
    }

    cancellationBoxOutput.setAdditionalRegisters({
        // R4: Estado del juego (2: Cancelado)
        R4: SInt(2).toHex(),
        // R5: Altura de bloque para el siguiente drenaje
        R5: SLong(newUnlockHeight).toHex(),
        // R6: El secreto 'S' revelado
        R6: SColl(SByte, secretS_bytes).toHex(),
        // R7: El valor restante (seguridad)
        R7: SLong(newValue).toHex(),
        // R8: Deadline original
        R8: SLong(BigInt(game.deadlineBlock)).toHex(),
        // R9: configBoxId  (Refactored)
        R9: SColl(SByte, configBoxIdBytes).toHex()
    });

    // SALIDA(1): Caja que paga la penalización al claimer
    const claimerValue = stakePortionToClaim < SAFE_MIN_BOX_VALUE ? SAFE_MIN_BOX_VALUE : stakePortionToClaim;
    const claimerTokens = game.participationTokenId == "" ? [] : [{
        tokenId: game.participationTokenId,
        amount: stakePortionToClaim
    }];

    const claimerBoxOutput = new OutputBuilder(
        claimerValue,
        claimerAddressString
    )
        .addTokens(claimerTokens);

    // --- 4. Construir y Enviar la Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(gameBoxToSpend), ...utxos];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([cancellationBoxOutput, claimerBoxOutput])
        .sendChangeTo(claimerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Transición a cancelación enviada con éxito. ID de la transacción: ${txId}`);
        return txId;
    }
    catch (error) {
        console.warn("Error al firmar o enviar la transacción de cancelación:", error);
        throw error;
    }
}