import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
    Box,
    OutputBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    TransactionBuilder,
    SAFE_MIN_BOX_VALUE
} from "@fleet-sdk/core";
import {
    SByte,
    SColl,
    SInt,
    SLong,
    SPair
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { getGopGameActiveErgoTree, getGopGameCancellationErgoTree, getGopFalseAddress } from "$lib/ergo/contract";
import { hexToBytes } from "$lib/ergo/utils";

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
    { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Game Cancellation (Refactored) - (%s)", (mode) => {
    let mockChain: MockChain;
    let game: ReturnType<MockChain["newParty"]>;
    let creator: ReturnType<MockChain["newParty"]>;
    let claimer: ReturnType<MockChain["newParty"]>;

    let gameActiveErgoTree: ReturnType<typeof compile>;
    let gameCancellationErgoTree: ReturnType<typeof compile>;

    const resolverStake = 10_000_000_000n;
    const deadlineBlock = 800_200;
    const secret = stringToBytes("utf8", "this-is-the-revealed-secret");
    const hashedSecret = blake2b256(secret);
    const gameNftId = "00aadd0000aadd0000aadd0000aadd0000aadd0000aadd0000aadd0000aadd00";

    let gameBox: Box;
    let configBox: any;
    let configBoxId: string;

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });
        game = mockChain.newParty("Game");
        creator = mockChain.newParty("GameCreator");
        claimer = mockChain.newParty("Claimer");
        claimer.addBalance({ nanoergs: 100_000_000n });

        gameCancellationErgoTree = getGopGameCancellationErgoTree();
        gameActiveErgoTree = getGopGameActiveErgoTree();

        // --- Create Config Box ---
        const falseAddress = getGopFalseAddress();
        configBox = {
            transactionId: "0000000000000000000000000000000000000000000000000000000000000001",
            index: 0,

            value: SAFE_MIN_BOX_VALUE,
            ergoTree: falseAddress.ergoTree,
            assets: [],
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SColl(SColl(SByte), []).toHex(),
                R5: SColl(SLong, [
                    1n, 20n, BigInt(deadlineBlock), resolverStake, 1_000_000n, 500n, 1000n
                ]).toHex(),
                R6: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
                R7: SColl(SByte, hashedSecret).toHex()
            }
        };
        creator.addUTxOs(configBox);
        configBoxId = creator.utxos.toArray().find(b => b.additionalRegisters.R5 === configBox.additionalRegisters.R5)!.boxId;

        const gameBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
        const gameAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
        ];

        // Active Box Refactored
        game.addUTxOs({
            value: gameBoxValue,
            ergoTree: gameActiveErgoTree.toHex(),
            assets: gameAssets,
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SInt(0).toHex(),
                R5: SColl(SByte, "ab".repeat(32)).toHex(), // Seed
                R6: SColl(SByte, hexToBytes(configBoxId)!).toHex()
            }
        });

        gameBox = game.utxos.toArray()[0];
    }, 15000);

    afterEach(() => {
        mockChain.reset({ clearParties: true });
    });

    it("should successfully cancel the game: Claimer receives 20%, Contract retains 80%", () => {
        const stakePortionForClaimer = resolverStake / 5n;
        const stakePortionForGame = resolverStake - stakePortionForClaimer;
        const newUnlockHeight = BigInt(mockChain.height + 40);

        const cancellationBoxValue = mode.token === ERG_BASE_TOKEN ? stakePortionForGame : RECOMMENDED_MIN_FEE_VALUE;
        const cancellationAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: stakePortionForGame }] : [])
        ];

        const penaltyBoxValue = mode.token === ERG_BASE_TOKEN ? stakePortionForClaimer : RECOMMENDED_MIN_FEE_VALUE;
        const penaltyAssets = mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: stakePortionForClaimer }] : [];

        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([
                new OutputBuilder(cancellationBoxValue, gameCancellationErgoTree)
                    .addTokens(cancellationAssets)
                    .setAdditionalRegisters({
                        R4: SInt(2).toHex(), // Cancelled
                        R5: SLong(newUnlockHeight).toHex(),
                        R6: SColl(SByte, secret).toHex(), // Revealed
                        R7: SLong(stakePortionForGame).toHex(),
                        R8: SLong(BigInt(deadlineBlock)).toHex(),
                        R9: SColl(SByte, hexToBytes(configBoxId)!).toHex() // Config Box ID
                    }),
                new OutputBuilder(penaltyBoxValue, claimer.address)
                    .addTokens(penaltyAssets)
            ])
            // Config Box MUST be DataInput
            .withDataFrom([creator.utxos.toArray().find(b => b.boxId === configBoxId)!])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(transaction, { signers: [claimer] });
        expect(executionResult, "La transacción debería ejecutarse correctamente").to.be.true;
    });

    it("should fail to cancel if the game deadline has passed", () => {
        mockChain.jumpTo(Number(deadlineBlock) + 1);
        const transaction = new TransactionBuilder(mockChain.height)
            .from([gameBox, ...claimer.utxos.toArray()])
            .to([new OutputBuilder(RECOMMENDED_MIN_FEE_VALUE, claimer.address)])
            .withDataFrom([creator.utxos.toArray().find(b => b.boxId === configBoxId)!])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();
        const executionResult = mockChain.execute(transaction, { signers: [claimer], throw: false });
        expect(executionResult).to.be.false;
    });
});