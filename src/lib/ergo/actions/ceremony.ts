import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE
} from '@fleet-sdk/core';
import { SColl, SByte, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import type { GameActive } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameActiveErgoTreeHex } from '../contract'; // Asume que esta función existe
import { stringToBytes } from '@scure/base';

declare const ergo: any;

/**
 * Ejecuta la acción "Open Ceremony" (action3_openCeremony) para un juego activo.
 */
export async function contribute_to_ceremony(
    game: GameActive,
    donation: bigint = 0n
): Promise<string | null> {

    console.log(`Iniciando contribución a ceremonia para el juego: ${game.boxId}`);
    if (donation > 0n) console.log(`Donación de: ${donation.toString()} para el token ${game.participationTokenId}`);

    const currentHeight = await ergo.get_current_height();

    // 1. --- Validación (Pre-checks) ---
    if (currentHeight >= game.ceremonyDeadline) {
        throw new Error("La ceremonia de apertura ha finalizado. No se puede agregar más entropía.");
    }

    const gameBoxToSpend = parseBox(game.box);
    if (BigInt(gameBoxToSpend.value) < SAFE_MIN_BOX_VALUE) {
        throw new Error(`La caja del juego tiene un valor (${gameBoxToSpend.value}) inferior al mínimo seguro (${SAFE_MIN_BOX_VALUE}).`);
    }

    if (!game.configBoxId) throw new Error("Game is missing configBoxId");

    // 2. --- Calcular el nuevo estado ---

    const oldSeedBytes = hexToBytes(game.seed);
    if (!oldSeedBytes) throw new Error("Seed (R5._1) del juego inválido.");

    const inputBoxIdBytes = hexToBytes(game.boxId);
    if (!inputBoxIdBytes) throw new Error("Box ID del juego inválido.");

    // Calcular: updated_seed = blake2b256(old_seed ++ INPUTS(0).id)
    const combinedBytes = new Uint8Array(oldSeedBytes.length + inputBoxIdBytes.length);
    combinedBytes.set(oldSeedBytes);
    combinedBytes.set(inputBoxIdBytes, oldSeedBytes.length);

    const updatedSeedBytes = fleetBlake2b256(combinedBytes);

    console.log(`Seed antiguo: ${game.seed}`);
    console.log(`Seed nuevo: ${uint8ArrayToHex(updatedSeedBytes)}`);

    // 3. --- Reconstruir Registros ---
    // R4: Sigue en estado 0 (Activo)
    const r4Hex = SInt(0).toHex();

    // R5: updated_seed (Coll[Byte])
    const r5Hex = SColl(SByte, updatedSeedBytes).toHex();

    // R6: configBoxId (Coll[Byte])
    const r6Hex = SColl(SByte, hexToBytes(game.configBoxId)!).toHex();

    // 4. --- Construir la Caja de Salida ---

    // Preparar tokens
    const currentTokens = gameBoxToSpend.assets.map((a: any) => ({ ...a }));
    if (donation > 0n && game.participationTokenId) {
        const index = currentTokens.findIndex((t: any) => t.tokenId === game.participationTokenId);
        if (index !== -1) {
            currentTokens[index].amount = (BigInt(currentTokens[index].amount) + donation).toString();
        } else {
            // Should not happen, but just in case.
            currentTokens.push({ tokenId: game.participationTokenId, amount: donation.toString() });
        }
    }

    const gameActiveErgoTree = getGopGameActiveErgoTreeHex();

    const ceremonyOutputBox = new OutputBuilder(
        BigInt(gameBoxToSpend.value),
        gameActiveErgoTree
    )
        .addTokens(currentTokens)
        .setAdditionalRegisters({
            R4: r4Hex,
            R5: r5Hex,
            R6: r6Hex
        });

    // 5. --- Construir y Enviar la Transacción ---

    const changeAddress = await ergo.get_change_address();

    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from([gameBoxToSpend, ...await ergo.get_utxos()])
            .to([ceremonyOutputBox])
            .sendChangeTo(changeAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Contribución a ceremonia enviada con éxito. ID de la transacción: ${txId}`);
        return txId;

    } catch (error) {
        console.error("Error al construir o enviar la transacción de ceremonia:", error);
        throw error;
    }
}