import {
    OutputBuilder,
    TransactionBuilder,
    ErgoAddress,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    SColl,
    SByte,
    SBool
} from '@fleet-sdk/core';
import { hexToBytes, bigintToLongByteArray } from '$lib/ergo/utils';
// we compute the reputation proof contract address from our compiled script
import { getReputationProofAddress } from '$lib/ergo/contract';
import { get } from 'svelte/store';
import { current_height, reputation_proof } from '$lib/common/store';
import { explorer_uri } from '$lib/ergo/envs';
import { GAME } from '$lib/ergo/reputation/types';
import type { GameActive } from '$lib/common/game';

declare const ergo: any;

function normalizeHex(value: string | null | undefined): string {
    if (typeof value !== "string") return "";
    return value.trim().replace(/^0x/i, "");
}

/**
 * Builds and submits a reputation opinion transaction specifically for a judge accepting a nomination.
 * This manually builds the transaction to store `R9` as `Coll[Coll[Byte]] = [commitment, preimage]`.
 * 
 * @param game The active game object
 * @param referenceParticipation The reference participation data used to verify the game execution
 * @returns The transaction ID if successful
 */
export async function submit_judge_opinion(
    game: GameActive,
    referenceParticipation: {
        commitmentC_hex: string;
        solverId_hex: string;
        score: bigint;
        hashLogs_hex: string;
        ergoTree_hex: string;
    }
): Promise<string> {
    const typeId = GAME;
    const object_pointer = game.gameId;
    const polarization = true;
    const is_locked = false;  // Could be true, but this allows the judge update the R9 data if was incorrect for some reason. Locked opinions cannot be updated, but unlocked ones can be updated by the judge if needed.

    const proof = get(reputation_proof);
    if (!proof) throw new Error("User has no reputation proof");

    const existingOpinion = proof.current_boxes.find(b => b.type.tokenId === typeId && b.object_pointer === object_pointer);
    if (existingOpinion) {
        throw new Error("Judge already accepted nomination. Updating is not supported for judge R9 commitments because the API requires creating a new opinion.");
    }

    const mainBox = proof.current_boxes.find(b => b.is_locked === false && b.object_pointer === b.token_id);
    if (!mainBox) throw new Error("No main reputation box found for the judge.");

    // Build the pre-image
    const solverIdHex = normalizeHex(referenceParticipation.solverId_hex);
    const seedHex = normalizeHex(game.seed);
    const hashLogsHex = normalizeHex(referenceParticipation.hashLogs_hex);
    const ergoTreeHex = normalizeHex(referenceParticipation.ergoTree_hex);

    const solverIdBytes = hexToBytes(solverIdHex);
    const seedBytes = hexToBytes(seedHex);
    const scoreBytes = bigintToLongByteArray(referenceParticipation.score);
    const hashLogsBytes = hexToBytes(hashLogsHex);
    const ergoTreeBytes = hexToBytes(ergoTreeHex);

    if (!solverIdBytes) throw new Error("Invalid solver ID hex.");
    if (!seedBytes) throw new Error("Invalid game seed hex.");
    if (!hashLogsBytes) throw new Error("Invalid hash logs hex.");
    if (!ergoTreeBytes) throw new Error("Invalid ergoTree hex.");

    const preimage = new Uint8Array([
        ...solverIdBytes,
        ...seedBytes,
        ...scoreBytes,
        ...hashLogsBytes,
        ...ergoTreeBytes,
    ]);

    const commitmentHex = normalizeHex(referenceParticipation.commitmentC_hex);
    const commitmentBytes = hexToBytes(commitmentHex);
    if (!commitmentBytes) {
        throw new Error("Failed to parse commitment hexadecimal string");
    }

    // Create the custom R9 Coll[Coll[Byte]]
    const r9Value = SColl(SColl(SByte), [commitmentBytes, preimage]);

    // Now build the transaction manually similar to create_opinion
    const creatorAddressString = await ergo.get_change_address();
    if (!creatorAddressString) {
        throw new Error("Could not get the creator's address from the wallet.");
    }
    const creatorP2PKAddress = ErgoAddress.fromBase58(creatorAddressString);

    // Get proposition bytes for R7
    const propositionBytes = hexToBytes(creatorP2PKAddress.ergoTree);
    if (!propositionBytes) {
        throw new Error(`Could not get proposition bytes from address ${creatorAddressString}.`);
    }

    const reputationTokenId = mainBox.token_id;
    const token_amount = 1n; // 1 token for the opinion box

    let totalReputationAvailable = mainBox.box.assets.reduce((sum, asset) => {
        if (asset.tokenId === reputationTokenId) {
            return sum + BigInt(asset.amount);
        } else {
            return sum;
        }
    }, 0n) - token_amount;

    if (totalReputationAvailable < 0n) {
        throw new Error("Not enough reputation tokens in main box.");
    }

    // Target address for reputation proofs (derived from our compiled contract)
    const ergoTreeAddress = getReputationProofAddress().toString();

    // MAIN BOX OUTPUT
    const main_box_output = new OutputBuilder(mainBox.box.value, ergoTreeAddress)
        .addTokens([{ tokenId: reputationTokenId, amount: totalReputationAvailable.toString() }, ...mainBox.box.assets.filter(a => a.tokenId !== reputationTokenId)])
        .setAdditionalRegisters(mainBox.box.additionalRegisters);

    // OPINION BOX OUTPUT
    const opinion_box_output = new OutputBuilder(BigInt(SAFE_MIN_BOX_VALUE), ergoTreeAddress);
    opinion_box_output.addTokens({ tokenId: reputationTokenId, amount: token_amount.toString() });

    opinion_box_output.setAdditionalRegisters({
        R4: SColl(SByte, hexToBytes(typeId) ?? new Uint8Array(0)).toHex(),
        R5: SColl(SByte, hexToBytes(object_pointer) ?? new Uint8Array(0)).toHex(),
        R6: SBool(is_locked).toHex(),
        R7: SColl(SByte, propositionBytes).toHex(),
        R8: SBool(polarization).toHex(),
        R9: r9Value.toHex(),
    });

    // Fetch Data Input (Type NFT)
    const typeTokenIds = new Set([mainBox.type.tokenId]);
    const dataInputs = [];
    const explorerUrl = get(explorer_uri);

    for (const tokenId of typeTokenIds) {
        const response = await fetch(`${explorerUrl}/api/v1/boxes/byTokenId/${tokenId}`);
        if (response.ok) {
            const box = (await response.json()).items[0];
            if (box) dataInputs.push(box);
        }
    }

    const utxos = await ergo.get_utxos();
    const inputs = [mainBox.box, ...utxos];
    const outputs = [main_box_output, opinion_box_output];

    const currentHeight = get(current_height) || await ergo.get_current_height();

    const builder = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(outputs)
        .sendChangeTo(creatorP2PKAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .withDataFrom(dataInputs)
        .build();

    const unsignedTransaction = builder.toEIP12Object();
    const signedTransaction = await ergo.sign_tx(unsignedTransaction);
    const transactionId = await ergo.submit_tx(signedTransaction);
    console.log("Accept judge nomination transaction ID ->", transactionId);
    return transactionId;
}
