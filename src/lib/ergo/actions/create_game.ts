import {
    OutputBuilder,
    SAFE_MIN_BOX_VALUE,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    ErgoAddress,
    BOX_VALUE_PER_BYTE,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SLong, SInt, SByte, SPair, serializeBox } from '@fleet-sdk/serializer';
declare const ergo: any;
import { hexToBytes, uint8ArrayToHex } from '$lib/ergo/utils';
import { getGopGameActiveErgoTreeHex, getGopMintIdtAddress, getGopFalseAddress } from '../contract';
import { stringToBytes } from '@scure/base';
import { getGameConstants } from '$lib/common/constants';
import { MAX_BOX_SIZE } from '../utils/box-size-calculator';

function randomSeed(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);

    return Array.from(array)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Creates transactions to generate a game with Config Box architecture.
 */
export async function create_game(
    gameServiceId: string,
    hashedSecret: string,
    deadlineBlock: number,
    resolverStakeAmount: bigint,
    participationFeeAmount: bigint,
    commissionPercentage: number,
    judges: string[],
    gameDetailsJson: string,
    perJudgeCommissionPercentage: number,
    participationTokenId: string,
    timeWeight: bigint
): Promise<string[] | null> {

    const seedHex = randomSeed();

    // Parse game details for NFT metadata
    let gameTitle = "Game of Prompts";
    let gameDescription = "A Game of Prompts competition";
    try {
        const details = JSON.parse(gameDetailsJson);
        if (details.title) gameTitle = details.title;
        if (details.description) gameDescription = details.description;
    } catch (e) {
        console.warn("Failed to parse game details JSON", e);
    }

    console.log("Attempting to create a game (Refactored):", {
        hashedSecret: hashedSecret.substring(0, 10) + "...",
        deadlineBlock,
        resolverStakeAmount: resolverStakeAmount.toString(),
        judges,
    });

    // --- 1. Address and Inputs ---
    const creatorAddressString = await ergo.get_change_address();
    if (!creatorAddressString) throw new Error("Could not get creator address.");

    const inputs: Box<Amount>[] = await ergo.get_utxos();
    if (!inputs || inputs.length === 0) throw new Error("No UTXOs found.");

    const creationHeight = await ergo.get_current_height();

    // --- 2. Prepare Data ---
    const hashedSecretBytes = hexToBytes(hashedSecret);
    if (!hashedSecretBytes) throw new Error("Invalid hashedSecret bytes");

    const seedBytes = hexToBytes(seedHex);
    if (!seedBytes) throw new Error("Invalid seed bytes");

    const gameDetailsBytes = stringToBytes("utf8", gameDetailsJson);
    const participationTokenIdBytes = participationTokenId ? hexToBytes(participationTokenId)! : new Uint8Array(0);

    const judgesColl = judges.map(j => hexToBytes(j)!).filter(b => b !== null);

    // --- 3. Build Config Box (Tx 1) ---
    // R4: judges, R5: params, R6: provenance, R7: secretHash
    const configR4 = SColl(SColl(SByte), judgesColl).toHex();
    const configR5 = SColl(SLong, [
        BigInt(creationHeight),
        timeWeight,
        BigInt(deadlineBlock),
        resolverStakeAmount,
        participationFeeAmount,
        BigInt(Math.round(perJudgeCommissionPercentage * 10000)),
        BigInt(Math.round(commissionPercentage * 10000))
    ]).toHex();
    const configR6 = SColl(SColl(SByte), [gameDetailsBytes, participationTokenIdBytes]).toHex();
    const configR7 = SColl(SByte, hashedSecretBytes).toHex();

    const configFalseAddress = getGopFalseAddress();
    const configErgoTreeHex = configFalseAddress.ergoTree;

    // Calculate mimimum value for Config Box
    const dummyConfigBox = {
        value: safeMinBoxValue(0), // Placeholder
        ergoTree: configErgoTreeHex,
        creationHeight: creationHeight,
        assets: [],
        additionalRegisters: {
            R4: configR4, R5: configR5, R6: configR6, R7: configR7
        }
    };
    const configBoxSize = serializeBox(dummyConfigBox).length;
    const configBoxValue = BigInt(configBoxSize) * BOX_VALUE_PER_BYTE + SAFE_MIN_BOX_VALUE; // Add margin

    const configBoxOutput = new OutputBuilder(configBoxValue, configFalseAddress)
        .setAdditionalRegisters({
            R4: configR4, R5: configR5, R6: configR6, R7: configR7
        });

    // Build Tx 1 (Config)
    // We use all inputs, send change to creator. The change box will be input for Tx 2.
    const unsignedTxConfig = new TransactionBuilder(creationHeight)
        .from(inputs)
        .to(configBoxOutput)
        .sendChangeTo(creatorAddressString)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const configBoxId = unsignedTxConfig.outputs[0].boxId;
    const configBoxIdBytes = hexToBytes(configBoxId);
    if (!configBoxIdBytes) throw new Error("Failed to get Config Box ID bytes");

    console.log("Planned Config Box ID:", configBoxId);

    // --- 4. Build Mint & Game Transactions (Chained) ---
    // Tx 2 (Mint) consumes Tx 1 Change.
    // Tx 3 (Game) consumes Tx 2 Mint Output.

    // 1. Config Tx (Already built: unsignedTxConfig)

    // 2. Mint Tx
    // We need to verify that Tx 1 produced a change box with the creator's ergoTree
    const creatorErgoTree = ErgoAddress.fromBase58(creatorAddressString).ergoTree;
    const tx1ChangeBox = unsignedTxConfig.outputs.find(o => o.ergoTree === creatorErgoTree);

    if (!tx1ChangeBox) throw new Error("Tx 1 did not produce a change output to fund Tx 2. Try adding more inputs.");
    const mintTokenId = tx1ChangeBox.boxId; // The ID of the input box for Mint Tx

    const mintOutput = new OutputBuilder(SAFE_MIN_BOX_VALUE, getGopMintIdtAddress())
        .mintToken({
            amount: 1n,
            name: gameTitle,
            decimals: 0,
            description: gameDescription
        });

    const unsignedTxMint = new TransactionBuilder(creationHeight)
        .from(tx1ChangeBox)
        .to(mintOutput)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .sendChangeTo(creatorAddressString)
        .build();

    // 3. Game Tx
    const activeGameErgoTree = getGopGameActiveErgoTreeHex();

    // Game Box Registers
    const gameR4 = SInt(0).toHex();
    const gameR5 = SColl(SByte, seedBytes).toHex();
    const gameR6 = SColl(SByte, configBoxIdBytes).toHex();

    // Calculate Game Box Size/Value
    const dummyGameBox = {
        value: safeMinBoxValue(0),
        ergoTree: activeGameErgoTree,
        creationHeight,
        assets: [{ tokenId: "00".repeat(32), amount: 1n }, { tokenId: participationTokenId, amount: resolverStakeAmount }],
        additionalRegisters: { R4: gameR4, R5: gameR5, R6: gameR6 }
    };
    const gameBoxSize = serializeBox(dummyGameBox).length;
    const gameBoxValue = BigInt(gameBoxSize) * BOX_VALUE_PER_BYTE + SAFE_MIN_BOX_VALUE;

    const mintBox = unsignedTxMint.outputs[0];
    const gameBoxOutput = new OutputBuilder(gameBoxValue, activeGameErgoTree)
        .addTokens([
            { tokenId: mintTokenId, amount: 1n },
            { tokenId: participationTokenId, amount: resolverStakeAmount }
        ])
        .setAdditionalRegisters({ R4: gameR4, R5: gameR5, R6: gameR6 });

    const unsignedTxGame = new TransactionBuilder(creationHeight)
        .from(mintBox)
        .to(gameBoxOutput)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .sendChangeTo(creatorAddressString)
        .build();

    // Sign and Submit All
    const unsignedTxs = [unsignedTxConfig, unsignedTxMint, unsignedTxGame];
    const txIds: string[] = [];

    console.log("Submitting chain of 3 transactions...");

    for (const unsignedTx of unsignedTxs.map(t => t.toEIP12Object())) {
        const signed = await ergo.sign_tx(unsignedTx);
        const txId = await ergo.submit_tx(signed);
        console.log(`Submitted Tx: ${txId}`);
        txIds.push(txId);
    }

    return txIds;
}

function safeMinBoxValue(size: number): bigint {
    return BigInt(Math.max(Number(SAFE_MIN_BOX_VALUE), size * Number(BOX_VALUE_PER_BYTE)));
}
