import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox } from '$lib/ergo/utils';
import { type GameResolution } from '$lib/common/game';
import { getGopEndGameErgoTreeHex } from '../contract';
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

export async function to_end_game(
    game: GameResolution
): Promise<string> {

    console.log(`[to_end_game] Starting transition to end game for: ${game.boxId}`);

    if (!game.configBoxId) throw new Error("Game is missing configBoxId");
    const configBox = await fetchBox(game.configBoxId);
    if (!configBox) throw new Error("Could not fetch Config Box");

    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    if (currentHeight < game.resolutionDeadline) {
        throw new Error("The resolution period has not yet ended.");
    }

    const endGameErgoTree = getGopEndGameErgoTreeHex();

    // We copy registers from Resolution Box to End Game Box
    // Structure matches: R4..R9
    const parsedInputBox = parseBox(game.box);

    const outputRegisters = {
        R4: parsedInputBox.additionalRegisters.R4,
        R5: parsedInputBox.additionalRegisters.R5,
        R6: parsedInputBox.additionalRegisters.R6,
        R7: parsedInputBox.additionalRegisters.R7,
        R8: parsedInputBox.additionalRegisters.R8,
        R9: parsedInputBox.additionalRegisters.R9
    };

    const endGameBoxOutput = new OutputBuilder(
        BigInt(game.box.value),
        endGameErgoTree
    )
        .addTokens(game.box.assets)
        .setAdditionalRegisters(outputRegisters);

    const utxos = await ergo.get_utxos();
    const inputs = [parsedInputBox, ...utxos];

    const dataInputs = [configBox];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(endGameBoxOutput)
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build()
        .toEIP12Object();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);
        console.log(`[to_end_game] Success! Tx ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.error("[to_end_game] Tx Error:", error);
        throw error;
    }
}
