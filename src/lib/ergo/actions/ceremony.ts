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
import { getGopGameActiveErgoTreeHex } from '../contract'; // Assume this function exists
import { stringToBytes } from '@scure/base';
import { ErgoPlatform } from '../platform';

declare const ergo: any;

/**
 * Executes the "Open Ceremony" action (action3_openCeremony) for an active game.
 * * This action allows anyone to "re-spend" the game box before the
 * 'ceremonyDeadline' to update the game seed (gameSeed), 
 * thus adding entropy.
 * * The new seed is calculated as:
 * updated_seed = blake2b256(old_seed ++ INPUTS(0).id)
 * * All other registers and box values are preserved.
 * * @param game The GameActive object (box to be consumed).
 * @returns The transaction ID if successful.
 */
export async function contribute_to_ceremony(
    game: GameActive,
    donation: bigint = 0n
): Promise<string | null> {

    console.log(`Starting ceremony contribution for game: ${game.boxId}`);
    if (donation > 0n) console.log(`Donation of: ${donation.toString()} for token ${game.participationTokenId}`);

    const currentHeight = await (new ErgoPlatform()).get_current_height();

    // 1. --- Validation (Pre-checks) ---
    if (currentHeight >= game.ceremonyDeadline) {
        throw new Error("The opening ceremony has ended. No more entropy can be added.");
    }

    const gameBoxToSpend = parseBox(game.box);
    if (BigInt(gameBoxToSpend.value) < SAFE_MIN_BOX_VALUE) {
        throw new Error(`The game box value (${gameBoxToSpend.value}) is lower than the safe minimum (${SAFE_MIN_BOX_VALUE}).`);
    }

    // 2. --- Calculate the new state ---

    const oldSeedBytes = hexToBytes(game.seed);
    if (!oldSeedBytes) throw new Error("Invalid game seed (R5._1).");

    const inputBoxIdBytes = hexToBytes(game.boxId);
    if (!inputBoxIdBytes) throw new Error("Invalid game box ID.");

    // Calculate: updated_seed = blake2b256(old_seed ++ INPUTS(0).id)
    // INPUTS(0).id es game.boxId
    const combinedBytes = new Uint8Array(oldSeedBytes.length + inputBoxIdBytes.length);
    combinedBytes.set(oldSeedBytes);
    combinedBytes.set(inputBoxIdBytes, oldSeedBytes.length);

    const updatedSeedBytes = fleetBlake2b256(combinedBytes);

    console.log(`Old seed: ${game.seed}`);
    console.log(`New seed: ${uint8ArrayToHex(updatedSeedBytes)}`);

    // 3. --- Reconstruct Registers ---
    // All registers must be identical, except R5._1

    // R4: Still in state 0 (Active)
    const r4Hex = SInt(0).toHex();

    // R5: updated_seed (Coll[Byte])
    const r5Hex = SColl(SByte, updatedSeedBytes).toHex();

    // R6: secretHash (preserved)
    const r6Hex = SColl(SByte, hexToBytes(game.secretHash)!).toHex();

    // R7: invitedJudges (preserved)
    const r7Hex = SColl(
        SColl(SByte),
        game.judges.map(tokenId => hexToBytes(tokenId)!)
    ).toHex();

    // R8: numericalParameters (preserved)
    const numericalParams = [
        BigInt(game.createdAt),
        game.timeWeight,
        BigInt(game.deadlineBlock),
        game.resolverStakeAmount,
        game.participationFeeAmount,
        game.perJudgeCommission,
        BigInt(game.resolverCommission),
        BigInt(game.devCommission)
    ];
    const r8Hex = SColl(SLong, numericalParams).toHex();

    const devScriptBytes = hexToBytes(game.devScript);
    if (!devScriptBytes) throw new Error("Invalid DEV_SCRIPT on game object");

    const r9 = [stringToBytes('utf8', game.content.rawJsonString), hexToBytes(game.participationTokenId) ?? "", devScriptBytes];
    console.log(`R9 values (bytes):`, r9);
    // R9: Coll[Coll[Byte]] -> [gameDetailsJSON, participationTokenId, devScript]
    const r9Hex = SColl(SColl(SByte), r9).toHex()

    // 4. --- Build Output Box ---

    // Prepare tokens
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
            R6: r6Hex,
            R7: r7Hex,
            R8: r8Hex,
            R9: r9Hex
        });

    // 5. --- Build and Send the Transaction ---

    const changeAddress = await ergo.get_change_address();

    try {
        const unsignedTransaction = new TransactionBuilder(currentHeight)
            .from(gameBoxToSpend, { ensureInclusion: true })
            .from(await ergo.get_utxos())
            .to([ceremonyOutputBox])
            .sendChangeTo(changeAddress)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
        const txId = await ergo.submit_tx(signedTransaction);

        console.log(`Ceremony contribution sent successfully. Transaction ID: ${txId}`);
        return txId;

    } catch (error) {
        console.error("Error building or sending the ceremony transaction:", error);
        throw error;
    }
}