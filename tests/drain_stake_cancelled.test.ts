import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
    Box,
    ErgoTree,
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
    SConstant
} from "@fleet-sdk/serializer";
import { stringToBytes } from "@scure/base";
import { getGopGameCancellationErgoTree, getGopFalseAddress } from "$lib/ergo/contract";
import { hexToBytes } from "$lib/ergo/utils";
import { blake2b256 } from "@fleet-sdk/crypto";

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const SAFE_BOX_VALUE = 2_000_000n;

const baseModes = [
    { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Game Stake Draining (Refactored) - (%s)", (mode) => {
    let mockChain: MockChain;
    let creator: ReturnType<MockChain["newParty"]>;
    let claimer: ReturnType<MockChain["newParty"]>;
    let gameCancellationContract: ReturnType<MockChain["newParty"]>;
    let gameCancellationErgoTree: ErgoTree = getGopGameCancellationErgoTree();

    const initialCancelledStake = 10_000_000_000n;
    const gameNftId = "11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11bbcc11";
    const revealedSecret = stringToBytes("utf8", "the-secret-is-out");
    const originalDeadline = 600_000;

    let cancelledGameBox: Box;
    let configBox: any;
    let configBoxId: string;

    beforeEach(() => {
        mockChain = new MockChain({ height: 800_000 });
        creator = mockChain.newParty("GameCreator");
        claimer = mockChain.newParty("Claimer");
        claimer.addBalance({ nanoergs: 1_000_000_000n });

        gameCancellationContract = mockChain.addParty(gameCancellationErgoTree.toHex(), "GameCancellationContract");

        const unlockHeight = mockChain.height - 1;

        // --- Create Config Box (Refactored) ---
        // Params: [createdAt, timeWeight, originalDeadline, resolverStake, participationFee, perJudgeComm, resolverComm]
        // Example values matching previous contexts
        const params = [1n, 20n, BigInt(originalDeadline), initialCancelledStake, 1000000n, 500n, 1000n];
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
                R5: SColl(SLong, params).toHex(),
                R6: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
                R7: SColl(SByte, blake2b256(stringToBytes("utf8", "secret"))).toHex()
            }
        };
        creator.addUTxOs(configBox);
        configBoxId = creator.utxos.toArray().find(b => b.additionalRegisters.R5 === configBox.additionalRegisters.R5)!.boxId;

        const gameBoxValue = mode.token === ERG_BASE_TOKEN ? initialCancelledStake : SAFE_BOX_VALUE;

        const gameAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: initialCancelledStake }] : [])
        ];

        gameCancellationContract.addUTxOs({
            ergoTree: gameCancellationErgoTree.toHex(),
            value: gameBoxValue,
            creationHeight: mockChain.height - 50,
            assets: gameAssets,
            additionalRegisters: {
                R4: SInt(2).toHex(),
                R5: SLong(BigInt(unlockHeight)).toHex(),
                R6: SColl(SByte, revealedSecret).toHex(),
                R7: SLong(initialCancelledStake).toHex(),
                R8: SLong(BigInt(originalDeadline)).toHex(),
                // R9: Config Box ID
                R9: SColl(SByte, hexToBytes(configBoxId)!).toHex()
            }
        });

        cancelledGameBox = gameCancellationContract.utxos.toArray()[0];
    });

    afterEach(() => {
        mockChain.reset({ clearParties: true });
    });

    it("should successfully drain a portion of the stake after the cooldown period", () => {
        const claimerInitialBalance = claimer.balance.nanoergs;
        // Fix: Use SConstant to properly decode the SLong Hex string, avoiding substring hacks.
        const unlockHeightFromRegister = Number(SConstant.from(cancelledGameBox.additionalRegisters.R5).data);
        expect(mockChain.height).to.be.greaterThan(unlockHeightFromRegister);

        const stakePortionToClaim = initialCancelledStake / 5n;
        const remainingStake = initialCancelledStake - stakePortionToClaim;
        const cooldownBlocks = 30;
        const cooldownMargin = 10;
        const newUnlockHeight = BigInt(mockChain.height + cooldownBlocks + cooldownMargin);

        const newCancellationBoxValue = mode.token === ERG_BASE_TOKEN ? remainingStake : SAFE_BOX_VALUE;
        const newCancellationAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: remainingStake }] : [])
        ];

        const claimValue = mode.token === ERG_BASE_TOKEN ? stakePortionToClaim : SAFE_BOX_VALUE;
        const claimAssets = mode.token !== ERG_BASE_TOKEN
            ? [{ tokenId: mode.token, amount: stakePortionToClaim }]
            : [];

        const transaction = new TransactionBuilder(mockChain.height)
            .from([cancelledGameBox, ...claimer.utxos.toArray()])
            // Include Config Box
            .withDataFrom([creator.utxos.toArray().find(b => b.boxId === configBoxId)!])
            .to([
                new OutputBuilder(newCancellationBoxValue, gameCancellationErgoTree)
                    .addTokens(newCancellationAssets)
                    .setAdditionalRegisters({
                        R4: SInt(2).toHex(),
                        R5: SLong(newUnlockHeight).toHex(),
                        R6: SColl(SByte, revealedSecret).toHex(),
                        R7: SLong(remainingStake).toHex(),
                        R8: SLong(BigInt(originalDeadline)).toHex(),
                        R9: cancelledGameBox.additionalRegisters.R9, // Keep ConfigID
                    }),
                new OutputBuilder(claimValue, claimer.address).addTokens(claimAssets)
            ])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(transaction, { signers: [claimer] });

        expect(executionResult).to.be.true;

        const newCancellationBoxes = gameCancellationContract.utxos.toArray();
        expect(newCancellationBoxes).to.have.length(1);

        const newCancellationBox = newCancellationBoxes[0];

        if (mode.token === ERG_BASE_TOKEN) {
            expect(newCancellationBox.value).to.equal(remainingStake);
        } else {
            expect(newCancellationBox.value).to.equal(SAFE_BOX_VALUE);
            expect(newCancellationBox.assets[1].tokenId).to.equal(mode.token);
            expect(newCancellationBox.assets[1].amount).to.equal(remainingStake);
        }

        expect(newCancellationBox.assets[0].tokenId).to.equal(gameNftId);
        expect(newCancellationBox.additionalRegisters.R5).to.equal(SLong(newUnlockHeight).toHex());
        expect(newCancellationBox.additionalRegisters.R7).to.equal(SLong(remainingStake).toHex());

        if (mode.token === ERG_BASE_TOKEN) {
            const expectedFinalBalance = claimerInitialBalance + stakePortionToClaim - RECOMMENDED_MIN_FEE_VALUE;
            expect(claimer.balance.nanoergs).to.equal(expectedFinalBalance);
        } else {
            const claimerTokenBalance = claimer.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
            expect(claimerTokenBalance).to.equal(stakePortionToClaim);
        }
    });

    it("should fail to drain the stake before the cooldown period ends", () => {
        // --- Arrange ---
        const futureUnlockHeight = mockChain.height + 10;
        gameCancellationContract.utxos.clear();

        const futureGameBoxValue = mode.token === ERG_BASE_TOKEN ? initialCancelledStake : SAFE_BOX_VALUE;
        const futureGameAssets = [
            { tokenId: gameNftId, amount: 1n },
            ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: initialCancelledStake }] : [])
        ];

        gameCancellationContract.addUTxOs({
            ergoTree: gameCancellationErgoTree.toHex(),
            value: futureGameBoxValue,
            creationHeight: mockChain.height,
            assets: futureGameAssets,
            additionalRegisters: {
                R4: SInt(2).toHex(),
                R5: SLong(BigInt(futureUnlockHeight)).toHex(),
                R6: SColl(SByte, revealedSecret).toHex(),
                R7: SLong(initialCancelledStake).toHex(),
                R8: SLong(BigInt(originalDeadline)).toHex(),
                // R9: Config Box ID
                R9: SColl(SByte, hexToBytes(configBoxId)!).toHex()
            }
        });
        const futureLockedBox = gameCancellationContract.utxos.toArray()[0];

        expect(mockChain.height).to.be.lessThan(futureUnlockHeight);

        // --- Act ---
        const transaction = new TransactionBuilder(mockChain.height)
            .from([futureLockedBox, ...claimer.utxos.toArray()])
            .withDataFrom([creator.utxos.toArray().find(b => b.boxId === configBoxId)!])
            .to([new OutputBuilder(100_000_000n, claimer.address)])
            .sendChangeTo(claimer.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        // --- Assert ---
        const executionResult = mockChain.execute(transaction, { signers: [claimer], throw: false });
        expect(executionResult).to.be.false;

        expect(gameCancellationContract.utxos.toArray()).to.have.length(1);
        expect(gameCancellationContract.utxos.toArray()[0].boxId).to.equal(futureLockedBox.boxId);
    });
});