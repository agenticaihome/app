import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE
} from '@fleet-sdk/core';
import { SColl, SByte, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, uint8ArrayToHex } from '$lib/ergo/utils';
import { type GameActive } from '$lib/common/game';
import { blake2b256 as fleetBlake2b256 } from "@fleet-sdk/crypto";
import { getGopGameCancellationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { ErgoPlatform } from '../platform';

declare const ergo: any;

// --- Constants for game_cancellation.es contract ---

/**
 * Initiates the cancellation of an active game, transitioning from GameActive -> GameCancellation.
 * This action reveals the 'S' secret before the deadline to penalize the creator.
 *
 * @param game The GameActive object to cancel.
 * @param secretS_hex The 'S' secret in hexadecimal format.
 * @param claimerAddressString The address of the user initiating the cancellation and claiming the penalty.
 * @returns A promise that resolves with the transaction ID if successful.
 */
export async function cancel_game(
    game: GameActive,
    secretS_hex: string,
    claimerAddressString: string
): Promise<string | null> {

    const maxBigInt = (a: bigint, b: bigint): bigint => (a > b ? a : b);

    console.warn(`Starting cancellation transition for game: ${game.boxId}`);

    // --- 1. Fetch data and perform pre-checks ---
    const currentHeight = await (new ErgoPlatform()).get_current_height();

    if (currentHeight >= game.deadlineBlock) {
        throw new Error("Game cancellation is only possible before the deadline.");
    }

    const gameBoxToSpend = game.box;
    if (!gameBoxToSpend) throw new Error("The GameBox data is not found in the game object.");

    const secretS_bytes = hexToBytes(secretS_hex);
    if (!secretS_bytes) throw new Error("Invalid secretS_hex format.");

    // Verify that the provided secret matches the hash in the active box.
    const hash_of_provided_secret = fleetBlake2b256(secretS_bytes);
    if (uint8ArrayToHex(hash_of_provided_secret) !== game.secretHash) {
        throw new Error("The provided secret does not match the hash in the GameBox.");
    }

    // --- 2. Calculate values for the new cancellation box and the penalty ---
    let stakePortionToClaim = game.resolverStakeAmount / BigInt(game.constants.STAKE_DENOMINATOR);
    const newValue = game.value - stakePortionToClaim;

    const gameTokens = [{
        tokenId: game.participationTokenId,
        amount: newValue
    }];

    // --- 3. Build Transaction Outputs ---

    // The address/ErgoTree of the new box will be that of the cancellation script.
    const cancellationContractErgoTree = getGopGameCancellationErgoTreeHex();
    const newUnlockHeight = BigInt(currentHeight + game.constants.COOLDOWN_IN_BLOCKS + 5);

    // OUTPUT(0): The new cancellation box (`game_cancellation.es`)
    const cancellationBoxOutput = new OutputBuilder(
        BigInt(game.box.value),
        cancellationContractErgoTree
    )
        .addTokens([gameBoxToSpend.assets[0], ...gameTokens]) // Preserve the game NFT
        .setAdditionalRegisters({
            // R4: Game state (2: Cancelled)
            R4: SInt(2).toHex(),
            // R5: Block height for the next drain
            R5: SLong(newUnlockHeight).toHex(),
            // R6: The revealed 'S' secret
            R6: SColl(SByte, secretS_bytes).toHex(),
            // R7: The portion to claim (constant)
            R7: SLong(stakePortionToClaim).toHex(),
            // R8: Original deadline
            R8: SLong(BigInt(game.deadlineBlock)).toHex(),
            // R9: Coll[Coll[Byte]] -> [gameDetailsJSON, participationTokenId]
            R9: SColl(SColl(SByte), [stringToBytes('utf8', game.content.rawJsonString), hexToBytes(game.participationTokenId) ?? ""]).toHex()
        });

    // OUTPUT(1): Box that pays the penalty to the claimer

    const claimerValue = game.participationTokenId == "" ? stakePortionToClaim : maxBigInt(stakePortionToClaim, SAFE_MIN_BOX_VALUE) + SAFE_MIN_BOX_VALUE;
    const claimerTokens = game.participationTokenId == "" ? [] : [{
        tokenId: game.participationTokenId,
        amount: claimerValue
    }];

    const claimerBoxOutput = new OutputBuilder(
        claimerValue,
        claimerAddressString
    )
        .addTokens(claimerTokens);


    // --- 4. Build and Send the Transaction ---
    const utxos = await ergo.get_utxos();

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(parseBox(gameBoxToSpend), { ensureInclusion: true })
        .and.from(utxos)
        .to([cancellationBoxOutput, claimerBoxOutput])
        .sendChangeTo(claimerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Cancellation transition sent successfully. Transaction ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.warn("Error signing or sending the cancellation transaction:", error);
        throw error;
    }
}