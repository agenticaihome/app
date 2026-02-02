import { beforeEach, describe, expect, it } from "vitest";
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
    SLong,
    SPair,
    SInt,
    SBool
} from "@fleet-sdk/serializer";
import { blake2b256, randomBytes } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, generate_pk_proposition, hexToBytes } from "$lib/ergo/utils";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree, getReputationProofErgoTree, getGopFalseAddress } from "$lib/ergo/contract";
import { DefaultGameConstants } from "$lib/common/constants";

const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
    { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

const JUDGE_PERIOD = BigInt(DefaultGameConstants.JUDGE_PERIOD + 10);

const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";

const createCommitment = (solverId: string, score: bigint, logsHash: Uint8Array, ergoTree: Uint8Array, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...(hexToBytes(seed) || new Uint8Array(0)), ...bigintToLongByteArray(score), ...logsHash, ...ergoTree, ...secret]));
};

describe.each(baseModes)("Game Resolution Invalidation Unavailable by Judges (Refactored) - (%s)", (mode) => {
    const mockChain = new MockChain({ height: 800_000 });

    let resolver: ReturnType<MockChain["newParty"]>;
    let invalidatedWinner: ReturnType<MockChain["newParty"]>;
    let judge1: ReturnType<MockChain["newParty"]>;
    let judge2: ReturnType<MockChain["newParty"]>;
    let judge3: ReturnType<MockChain["newParty"]>;
    let creator: ReturnType<MockChain["newParty"]>;

    let gameResolutionContract: ReturnType<MockChain["newParty"]>;
    let participationContract: ReturnType<MockChain["newParty"]>;
    let reputationProofContract: ReturnType<MockChain["newParty"]>;

    let gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();
    let participationErgoTree: ErgoTree = getGopParticipationErgoTree();
    let reputationProofErgoTree: ErgoTree = getReputationProofErgoTree();

    const currentHeight = 800_000;
    const resolutionDeadline = BigInt(currentHeight) + JUDGE_PERIOD;
    const gameNftId = "33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aabb33aa";
    let secret = stringToBytes("utf8", "secret-for-invalidation-test");

    let gameResolutionBox: Box;
    let invalidatedWinnerBox: Box;
    let judge1ReputationBox: Box;
    let judge2ReputationBox: Box;
    let configBox: any;
    let configBoxId: string;

    let invalidatedCommitment: Uint8Array;
    let judge1TokenId: string;
    let judge2TokenId: string;
    let judge3TokenId: string;

    beforeEach(() => {
        mockChain.reset({ clearParties: true });
        mockChain.jumpTo(currentHeight);
    });

    it("should successfully invalidate the current winner as unavailable with a majority of judge votes (2 out of 3)", () => {
        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
        reputationProofContract = mockChain.addParty(reputationProofErgoTree.toHex(), "ReputationProof");

        resolver = mockChain.newParty("Resolver");
        invalidatedWinner = mockChain.newParty("InvalidatedWinner");
        judge1 = mockChain.newParty("Judge1");
        judge2 = mockChain.newParty("Judge2");
        judge3 = mockChain.newParty("Judge3");
        creator = mockChain.newParty("Creator");

        resolver.addBalance({ nanoergs: 10_000_000_000n });

        const invalidatedLogsHash = blake2b256(stringToBytes("utf8", "logs-invalid"));
        invalidatedCommitment = createCommitment("solver-invalid", 230n, invalidatedLogsHash, prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0]), secret);

        judge1TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge2TokenId = Buffer.from(randomBytes(32)).toString("hex");
        judge3TokenId = Buffer.from(randomBytes(32)).toString("hex");
        const judges = [judge1TokenId, judge2TokenId, judge3TokenId].map(id => Buffer.from(id, "hex"));

        // --- Create Config Box ---
        const params = [1n, 20n, 700_000n, 2_000_000_000n, 1_000_000n, 1n, 10n];
        const falseAddress = getGopFalseAddress();
        configBox = {
            transactionId: "0000000000000000000000000000000000000000000000000000000000000001",
            index: 0,

            value: SAFE_MIN_BOX_VALUE,
            ergoTree: falseAddress.ergoTree,
            assets: [],
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SColl(SColl(SByte), judges).toHex(),
                R5: SColl(SLong, params).toHex(),
                R6: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
                R7: SColl(SByte, blake2b256(secret)).toHex()
            }
        };
        creator.addUTxOs(configBox);
        configBoxId = creator.utxos.toArray().find(b => b.additionalRegisters.R5 === configBox.additionalRegisters.R5)!.boxId;

        // --- Create Game Resolution Box (Refactored) ---
        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: RECOMMENDED_MIN_FEE_VALUE,
            assets: [
                { tokenId: gameNftId, amount: 1n },
                { tokenId: USD_BASE_TOKEN, amount: 2_000_000_000n }
            ],
            creationHeight: mockChain.height - 30,
            additionalRegisters: {
                R4: SInt(1).toHex(),
                R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),
                R6: SPair(
                    SColl(SByte, secret),
                    SColl(SByte, invalidatedCommitment)
                ).toHex(),
                // R7: [resolutionDeadline, 1, 10]
                R7: SColl(SLong, [BigInt(resolutionDeadline), 1n, 10n]).toHex(),
                // R8: Resolver PK
                R8: SColl(SByte, resolver.address.getPublicKeys()[0]).toHex(),
                // R9: Config Box ID
                R9: SColl(SByte, hexToBytes(configBoxId)!).toHex()
            }
        });
        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // --- Participation Box ---
        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            value: 1_000_000n,
            creationHeight: 700_000 - 30,
            assets: [{ tokenId: USD_BASE_TOKEN, amount: 1_000_000n }],
            additionalRegisters: {
                R4: SColl(SByte, prependHexPrefix(invalidatedWinner.address.getPublicKeys()[0])).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SColl(SByte, hexToBytes(gameNftId) ?? new Uint8Array(0)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-invalid")).toHex(),
                R8: SColl(SByte, invalidatedLogsHash).toHex(),
                R9: SColl(SLong, [100n, 200n]).toHex(),
            }
        });
        invalidatedWinnerBox = participationContract.utxos.toArray()[0];

        // --- Reputation Proofs (UNAVAILABLE TYPE) ---
        const unavailableTypeNftId = DefaultGameConstants.PARTICIPATION_UNAVAILABLE_TYPE_ID;
        reputationProofContract.addUTxOs({
            creationHeight: mockChain.height - 10,
            ergoTree: reputationProofErgoTree.toHex(),
            value: 1_000_000n,
            assets: [{ tokenId: judge1TokenId, amount: 1n }],
            additionalRegisters: {
                R4: SColl(SByte, hexToBytes(unavailableTypeNftId) ?? new Uint8Array(0)).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SBool(true).toHex(),
                R7: generate_pk_proposition(judge1.address.encode()),
                R8: SBool(false).toHex(), // Unavailable considered failure to validate? Or invalid?
                // Actually UNAVAILABLE type usually implies the participant data is missing.
                // The boolean R8 usually means "Is Valid?". False = Invalid.
                R9: SColl(SByte, []).toHex(),
            }
        });
        reputationProofContract.addUTxOs({
            creationHeight: mockChain.height - 10,
            ergoTree: reputationProofErgoTree.toHex(),
            value: 1_000_000n,
            assets: [{ tokenId: judge2TokenId, amount: 1n }],
            additionalRegisters: {
                R4: SColl(SByte, hexToBytes(unavailableTypeNftId) ?? new Uint8Array(0)).toHex(),
                R5: SColl(SByte, invalidatedCommitment).toHex(),
                R6: SBool(true).toHex(),
                R7: generate_pk_proposition(judge2.address.encode()),
                R8: SBool(false).toHex(),
                R9: SColl(SByte, []).toHex(),
            }
        });
        judge1ReputationBox = reputationProofContract.utxos.toArray()[0];
        judge2ReputationBox = reputationProofContract.utxos.toArray()[1];

        // --- Transaction ---
        const newFunds = BigInt(gameResolutionBox.value) + BigInt(invalidatedWinnerBox.value);
        const extendedDeadline = BigInt(resolutionDeadline) + JUDGE_PERIOD;

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, invalidatedWinnerBox, ...resolver.utxos.toArray()])
            .to([
                new OutputBuilder(newFunds, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .addTokens(invalidatedWinnerBox.assets)
                    .setAdditionalRegisters({
                        R4: SInt(1).toHex(),
                        R5: gameResolutionBox.additionalRegisters.R5,
                        R6: SPair(SColl(SByte, secret), SColl(SByte, [])).toHex(), // Reset winner
                        R7: SColl(SLong, [extendedDeadline, 1n, 10n]).toHex(), // Extend deadline
                        R8: gameResolutionBox.additionalRegisters.R8,
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            .withDataFrom([
                creator.utxos.toArray().find(b => b.boxId === configBoxId)!,
                judge1ReputationBox,
                judge2ReputationBox
            ])
            .sendChangeTo(resolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const executionResult = mockChain.execute(tx, { signers: [resolver as any] });
        expect(executionResult).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        expect(newGameBox.additionalRegisters.R7).to.equal(SColl(SLong, [extendedDeadline, 1n, 10n]).toHex());
    });
});