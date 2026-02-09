import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE
} from '@fleet-sdk/core';
import { SColl, SByte, SLong, SInt } from '@fleet-sdk/serializer';
import { parseBox, hexToBytes } from '$lib/ergo/utils';
import { type GameCancellation } from '$lib/common/game';
import { getGopGameCancellationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';
import { ErgoPlatform } from '../platform';

declare const ergo: any;

const COOLDOWN_IN_BLOCKS_MARGIN = 10;

/**
 * Executes the drain action on a game box in the "Cancellation" state.
 * Anyone can call this function after the cooldown period has ended
 * to claim a portion of the resolver's stake and recreate the box for the next cycle.
 *
 * @param game The GameCancellation object to act upon.
 * @param claimerAddressString The address of the user executing the action, who will receive the stake portion.
 * @returns A promise that resolves with the transaction ID if successful.
 */
export async function drain_cancelled_game_stake(
    game: GameCancellation,
    claimerAddressString: string
): Promise<string | null> {

    console.log(`Attempting to drain the stake of the cancelled game: ${game.boxId}`);

    // --- 1. Preliminary Checks ---
    const currentHeight = await (new ErgoPlatform()).get_current_height();
    if (currentHeight < game.unlockHeight) {
        throw new Error(`The cooldown period has not ended. Draining is only possible after block ${game.unlockHeight}.`);
    }

    const portionToClaim = game.portionToClaim; // R7

    let currentStake: bigint;
    if (game.participationTokenId === "") {
        currentStake = BigInt(game.box.value);
    } else {
        const token = game.box.assets.find(t => t.tokenId === game.participationTokenId);
        currentStake = BigInt(token ? token.amount : 0);
    }

    const remainingStake = currentStake - portionToClaim;

    // --- 2. Build Outputs ---
    const cancellationContractErgoTree = getGopGameCancellationErgoTreeHex();
    const newUnlockHeight = BigInt(currentHeight + game.constants.COOLDOWN_IN_BLOCKS + COOLDOWN_IN_BLOCKS_MARGIN);
    const revealedSecretBytes = hexToBytes(game.revealedS_Hex);
    if (!revealedSecretBytes) throw new Error("Could not convert revealed secret hex to bytes.");

    const nextBoxTokens = [game.box.assets[0]]; // Always preserve NFT
    nextBoxTokens.push({ tokenId: game.participationTokenId, amount: remainingStake });

    // const claimerTokens = [{ tokenId: game.participationTokenId, amount: stakePortionToClaim }];  sendChangeTo will handle it

    // OUTPUT(0): The recreated cancellation box with updated values
    const recreatedCancellationBox = new OutputBuilder(
        BigInt(game.box.value),
        cancellationContractErgoTree
    )
        .addTokens(nextBoxTokens)
        .setAdditionalRegisters({
            // Correct register structure from the test
            R4: SInt(2).toHex(), // State: Cancelled
            R5: SLong(newUnlockHeight).toHex(),
            R6: SColl(SByte, revealedSecretBytes).toHex(),
            R7: SLong(portionToClaim).toHex(), // R7 always tracks the portion to claim (constant)
            R8: SLong(BigInt(game.deadlineBlock)).toHex(),
            R9: SColl(SColl(SByte), [stringToBytes('utf8', game.content.rawJsonString), hexToBytes(game.participationTokenId) ?? ""]).toHex()
        });

    // --- 3. Build and Send the Transaction ---
    const utxos = await ergo.get_utxos();

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(parseBox(game.box), { ensureInclusion: true })
        .and.from(utxos)
        .to([recreatedCancellationBox])
        .sendChangeTo(claimerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Stake drain transaction sent successfully. ID: ${txId}`);
        return txId;
    }
    catch (error) {
        throw new Error("Error: https://github.com/game-of-prompts/app/issues/3");
    }
}