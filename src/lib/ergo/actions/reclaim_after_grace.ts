import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    ErgoAddress,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { parseBox } from '$lib/ergo/utils';
import type { GameActive, ValidParticipation } from '$lib/common/game';
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
 * Builds and sends a transaction for a participant to claim their share
 * if the game creator fails to resolve it after a grace period has passed.
 */
export async function reclaim_after_grace(
    game: GameActive,
    participation: ValidParticipation
): Promise<string> {
    console.log(`[reclaim_after_grace] Initiating reclaim for participation: ${participation.boxId}`);

    if (!game.configBoxId) throw new Error("Game is missing configBoxId");
    const configBox = await fetchBox(game.configBoxId);
    if (!configBox) throw new Error("Could not fetch Config Box");

    // --- 1. Get user and chain data ---
    const userAddress = await ergo.get_change_address();
    const utxos: Box<Amount>[] = await ergo.get_utxos();
    const currentHeight = await ergo.get_current_height();

    // --- 2. Preliminary validations ---
    if (!utxos || utxos.length === 0) {
        throw new Error("No UTXOs found in the wallet to cover the transaction fee.");
    }

    // --- 3. Prepare transaction inputs and outputs ---

    if (!participation.playerPK_Hex) throw new Error("Participation does not have a player PK.");
    const playerAddress = ErgoAddress.fromPublicKey(participation.playerPK_Hex);
    const participationInput = parseBox(participation.box);
    const gameDataInput = parseBox(game.box);

    const refundOutput = new OutputBuilder(
        BigInt(participationInput.value),
        playerAddress
    );

    const dataInputs = [gameDataInput, configBox];

    // --- 4. Build and send the transaction ---
    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from([participationInput, ...utxos]) // Inputs to be spent
        .withDataFrom(dataInputs)
        .to(refundOutput)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    console.log("Unsigned reclaim transaction (grace period):", unsignedTransaction.toEIP12Object());

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`✅ Success! Reclaim transaction sent. ID: ${txId}`);
        return txId;
    } catch (error) {
        console.error("Error signing or sending the reclaim transaction:", error);
        throw error;
    }
}
