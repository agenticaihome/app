import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type InputBox
} from '@fleet-sdk/core';
import { SColl, SByte, SLong, SInt } from '@fleet-sdk/serializer';
import { parseBox, hexToBytes } from '$lib/ergo/utils';
import { type GameCancellation } from '$lib/common/game';
import { getGopGameCancellationErgoTreeHex } from '../contract';
import { stringToBytes } from '@scure/base';

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
    const currentHeight = await ergo.get_current_height();
    if (currentHeight < game.unlockHeight) {
        throw new Error(`The cooldown period has not ended. Draining is only possible after block ${game.unlockHeight}.`);
    }

    const stakeToDrain = BigInt(game.resolverStakeAmount);
    const stakePortionToClaim = stakeToDrain / BigInt(game.constants.STAKE_DENOMINATOR);
    const remainingStake = stakeToDrain - stakePortionToClaim;

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
            R7: SLong(remainingStake).toHex(), // R7 always tracks the relevant stake amount (ERG or Token)
            R8: SLong(BigInt(game.deadlineBlock)).toHex(),
            R9: SColl(SColl(SByte), [stringToBytes('utf8', game.content.rawJsonString), hexToBytes(game.participationTokenId) ?? ""]).toHex()
        });

    // --- 3. Build and Send the Transaction ---
    const utxos: InputBox[] = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...utxos];

    console.log("R5 value of the input: ", inputs[0].additionalRegisters.R5);
    // Shows R5 05a49ed101 (1714066)

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to([recreatedCancellationBox])
        .sendChangeTo(claimerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    console.log(unsignedTransaction.inputs[0].additionalRegisters)
    // Here stills R5 == 05a49ed101

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Stake drain transaction sent successfully. ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.warn(error)
         // FIRST TEST:  SELF.R5 es 1714239.
         // SECOND TEST:  SELF.R5 es 1714260.
         // WHY CHANGED?  Why not 1714066?
        throw error;
    }
}