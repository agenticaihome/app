import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SLong, SByte } from '@fleet-sdk/serializer';
import { hexToBytes } from '$lib/ergo/utils';
import { getGopParticipationErgoTreeHex } from '../contract'; // <-- Importación actualizada
import { prependHexPrefix } from '$lib/utils';
import { ErgoPlatform } from '../platform';

declare var ergo: any;

/**
 * Builds and sends a transaction to create a participation box in "Submitted" state.
 * @param gameNftIdHex - ID of the game NFT the player is joining (for R6).
 * @param scoreList - List of scores to obfuscate the real one (for R9).
 * @param participationFeeForBox - Participation fee that will be the box value.
 * @param commitmentCHex - The cryptographic commitment with the real score (for R5).
 * @param solverIdString - The solver ID/name (for R7).
 * @param hashLogsHex - The game logs hash (for R8).
 * @returns The ID of the submitted transaction.
 */
export async function submit_score(
    gameNftIdHex: string,
    scoreList: bigint[],
    participationFeeForBox: bigint,
    participationTokenId: string,
    commitmentCHex: string,
    solverIdString: string,
    hashLogsHex: string
): Promise<string | null> {

    if (scoreList.length > 10) {
        throw new Error("The scores list cannot have more than 10 items.");
    }

    console.log("Attempting to submit score with parameters:", {
        gameNftIdHex,
        scoreList: scoreList.map(s => s.toString()),
        participationFeeForBox: participationFeeForBox.toString(),
        commitmentCHex,
        solverIdString,
        hashLogsHex
    });

    const gameValue = SAFE_MIN_BOX_VALUE;
    const gameTokens = [{
        tokenId: participationTokenId,
        amount: participationFeeForBox
    }];

    // 1. Get player's public key from the wallet
    const playerAddressString = await ergo.get_change_address();
    if (!playerAddressString) {
        throw new Error("Could not get the player's address from the wallet.");
    }
    const playerP2PKAddress = ErgoAddress.fromBase58(playerAddressString);
    const playerPkBytes = playerP2PKAddress.getPublicKeys()[0];
    if (!playerPkBytes) {
        throw new Error(`Could not extract the public key from the player's address (${playerAddressString}).`);
    }

    // 2. Get player's UTXOs to cover the fee
    const inputs: Box<Amount>[] = await ergo.get_utxos();
    if (!inputs || inputs.length === 0) {
        throw new Error("No UTXOs found in the wallet. Make sure you have funds.");
    }

    // 3. Get the participation contract ErgoTree
    const participationContractErgoTree = getGopParticipationErgoTreeHex(); // <-- Using updated function
    if (!participationContractErgoTree) {
        throw new Error("Could not get the participation contract ErgoTree.");
    }

    // 4. Prepare values for the registers
    const commitmentC_bytes = hexToBytes(commitmentCHex);
    if (!commitmentC_bytes) throw new Error("Could not convert commitmentC to bytes.");

    const gameNftId_bytes = hexToBytes(gameNftIdHex);
    if (!gameNftId_bytes) throw new Error("Could not convert gameNftId to bytes.");

    const hashLogs_bytes = hexToBytes(hashLogsHex);
    if (!hashLogs_bytes) throw new Error("Could not convert hashLogs to bytes.");

    // 5. Build output box (ParticipationBox)
    const participationBoxOutput = new OutputBuilder(
        gameValue,
        participationContractErgoTree
    )
        .addTokens(gameTokens)
        .setAdditionalRegisters({
            R4: SColl(SByte, prependHexPrefix(playerPkBytes)).toHex(),
            R5: SColl(SByte, commitmentC_bytes).toHex(),
            R6: SColl(SByte, gameNftId_bytes).toHex(),
            R7: SColl(SByte, hexToBytes(solverIdString)!).toHex(),
            R8: SColl(SByte, hashLogs_bytes).toHex(),
            R9: SColl(SLong, scoreList).toHex()
        });

    // 6. Build and sign the transaction
    const creationHeight = await (new ErgoPlatform()).get_current_height();
    const unsignedTransaction = new TransactionBuilder(creationHeight)
        .from(inputs)
        .to(participationBoxOutput)
        .sendChangeTo(playerAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    if (!signedTransaction) {
        throw new Error("The user canceled or failed to sign the transaction.");
    }

    // 7. Send the transaction to the network
    const transactionId = await ergo.submit_tx(signedTransaction);
    if (!transactionId) {
        throw new Error("Failed to send the transaction to the network.");
    }

    console.log(`Transaction submitted successfully. ID: ${transactionId}`);
    return transactionId;
}