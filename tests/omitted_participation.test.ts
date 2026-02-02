import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain, type KeyedMockChainParty } from "@fleet-sdk/mock-chain";
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
    SInt
} from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, hexToBytes } from "$lib/ergo/utils";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree, getGopFalseAddress } from "$lib/ergo/contract";
import { DefaultGameConstants } from "$lib/common/constants";

const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
    { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Omitted Participation Inclusion (Refactored) - (%s)", (mode) => {
    let mockChain: MockChain;

    let originalResolver: KeyedMockChainParty;
    let newResolver: KeyedMockChainParty;
    let currentWinnerPlayer: KeyedMockChainParty;
    let omittedPlayer: KeyedMockChainParty;
    let creator: KeyedMockChainParty;

    let gameResolutionContract: ReturnType<MockChain["addParty"]>;
    let participationContract: ReturnType<MockChain["addParty"]>;

    const gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();
    const participationErgoTree: ErgoTree = getGopParticipationErgoTree();

    const initial_height = 800_000;
    const resolutionDeadline = initial_height + DefaultGameConstants.JUDGE_PERIOD;
    const gameNftId = "22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22ccdd22";
    const secret = stringToBytes("utf8", "shared-secret-for-omitted-test");
    const game_deadline = 700_700n;

    const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";

    let gameResolutionBox: Box;
    let currentWinnerBox: Box;
    let omittedParticipantBox: Box;
    let configBox: any;
    let configBoxId: string;

    let winnerCommitment: Uint8Array;
    let omittedCommitment: Uint8Array;

    const createCommitment = (solverId: string, score: bigint, logsHash: Uint8Array, ergoTree: Uint8Array, secret: Uint8Array): Uint8Array => {
        return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...(hexToBytes(seed) || new Uint8Array(0)), ...bigintToLongByteArray(score), ...logsHash, ...ergoTree, ...secret]));
    };

    beforeEach(() => {
        mockChain = new MockChain({ height: initial_height });

        originalResolver = mockChain.newParty("OriginalResolver");
        newResolver = mockChain.newParty("NewResolver");
        currentWinnerPlayer = mockChain.newParty("CurrentWinner");
        omittedPlayer = mockChain.newParty("OmittedPlayer");
        creator = mockChain.newParty("Creator");

        newResolver.addBalance({
            tokens: [{ tokenId: mode.token, amount: 2_000_000_000n * 2n }],
            nanoergs: 10_000_000_000n
        });

        gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolution");
        participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");
    });

    afterEach(() => {
        mockChain.reset({ clearParties: true });
    });

    const setupScenario = (
        winnerScore: bigint,
        omittedScore: bigint,
        omittedCreationHeight: number = 600_000,
        omittedScores: bigint[] = [],
        newBlocks: number = 10,
        no_current_winner: boolean = false
    ) => {
        gameResolutionContract.utxos.clear();
        participationContract.utxos.clear();

        const winnerErgotree = prependHexPrefix(currentWinnerPlayer.address.getPublicKeys()[0]);
        const omittedErgotree = prependHexPrefix(omittedPlayer.address.getPublicKeys()[0]);

        const winnerLogsHash = blake2b256(stringToBytes("utf8", "logs-winner"));
        const omittedLogsHash = blake2b256(stringToBytes("utf8", "logs-omitted"));

        winnerCommitment = createCommitment("solver-winner", winnerScore, winnerLogsHash, winnerErgotree, secret);
        omittedCommitment = createCommitment("solver-omitted", omittedScore, omittedLogsHash, omittedErgotree, secret);

        // --- Create Config Box (Refactored) ---
        // Params must match what contract expects
        const params = [1n, 20n, game_deadline, 2_000_000_000n, 1_000_000n, 10000n, 200000n];

        const falseAddress = getGopFalseAddress();
        configBox = {
            transactionId: "0000000000000000000000000000000000000000000000000000000000000001",
            index: 0,

            value: SAFE_MIN_BOX_VALUE,
            ergoTree: falseAddress.ergoTree,
            assets: [],
            creationHeight: mockChain.height,
            additionalRegisters: {
                R4: SColl(SColl(SByte), []).toHex(), // Judges
                R5: SColl(SLong, params).toHex(),    // Params
                R6: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
                R7: SColl(SByte, blake2b256(secret)).toHex() // Secret Hash (irrelevant here but good for consistency)
            }
        };
        creator.addUTxOs(configBox);
        configBoxId = creator.utxos.toArray().find(b => b.additionalRegisters.R5 === configBox.additionalRegisters.R5)!.boxId;

        const gameBoxValue = RECOMMENDED_MIN_FEE_VALUE;
        const gameAssets = [
            { tokenId: gameNftId, amount: 1n },
            { tokenId: mode.token, amount: 2_000_000_000n }
        ];

        // --- Resolution Box (Refactored) ---
        gameResolutionContract.addUTxOs({
            ergoTree: gameResolutionErgoTree.toHex(),
            value: gameBoxValue,
            assets: gameAssets,
            creationHeight: mockChain.height - 10,
            additionalRegisters: {
                R4: SInt(1).toHex(),
                R5: SColl(SByte, hexToBytes(seed) ?? "").toHex(),
                R6: SPair(
                    SColl(SByte, secret),
                    SColl(SByte, no_current_winner ? new Uint8Array([]) : winnerCommitment)
                ).toHex(),
                // R7: [resolutionDeadline, perJudge, resolverComm]
                R7: SColl(SLong, [BigInt(resolutionDeadline), 1n, 20n]).toHex(),
                // R8: Resolver PK
                R8: SColl(SByte, Buffer.from(originalResolver.address.getPublicKeys()[0])).toHex(),
                // R9: Config Box ID
                R9: SColl(SByte, hexToBytes(configBoxId)!).toHex()
            }
        });

        gameResolutionBox = gameResolutionContract.utxos.toArray()[0];

        // --- Participations ---
        const participationValue = RECOMMENDED_MIN_FEE_VALUE;
        const participationAssets = [{ tokenId: mode.token, amount: 1_000_000n }];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            value: participationValue,
            creationHeight: 600_000,
            assets: participationAssets,
            additionalRegisters: {
                R4: SColl(SByte, winnerErgotree).toHex(),
                R5: SColl(SByte, winnerCommitment).toHex(),
                R6: SColl(SByte, hexToBytes(gameNftId) ?? new Uint8Array(0)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-winner")).toHex(),
                R8: SColl(SByte, winnerLogsHash).toHex(),
                R9: SColl(SLong, [winnerScore]).toHex(),
            }
        });
        currentWinnerBox = participationContract.utxos.toArray()[0];

        participationContract.addUTxOs({
            ergoTree: participationErgoTree.toHex(),
            assets: participationAssets,
            value: participationValue,
            creationHeight: omittedCreationHeight,
            additionalRegisters: {
                R4: SColl(SByte, omittedErgotree).toHex(),
                R5: SColl(SByte, omittedCommitment).toHex(),
                R6: SColl(SByte, hexToBytes(gameNftId) ?? new Uint8Array(0)).toHex(),
                R7: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex(),
                R8: SColl(SByte, omittedLogsHash).toHex(),
                R9: SColl(SLong, [omittedScore, ...omittedScores]).toHex(),
            }
        });
        omittedParticipantBox = participationContract.utxos.toArray()[1];

        // Solver boxes
        const FALSE_SCRIPT_ERGOTREE = "1906010100d17300";
        const winnerSolverIdBox = { creationHeight: 600_000, ergoTree: FALSE_SCRIPT_ERGOTREE, assets: [], value: RECOMMENDED_MIN_FEE_VALUE, additionalRegisters: { R4: SColl(SByte, stringToBytes("utf8", "solver-winner")).toHex() } };
        const omittedSolverIdBox = { creationHeight: omittedCreationHeight, ergoTree: FALSE_SCRIPT_ERGOTREE, assets: [], value: RECOMMENDED_MIN_FEE_VALUE, additionalRegisters: { R4: SColl(SByte, stringToBytes("utf8", "solver-omitted")).toHex() } };
        originalResolver.addUTxOs([winnerSolverIdBox, omittedSolverIdBox]);

        mockChain.newBlocks(newBlocks);
    };

    it("should include an omitted participant who becomes the new winner", () => {
        setupScenario(1000n, 1200n);

        const tx = new TransactionBuilder(mockChain.height)
            .from([gameResolutionBox, ...newResolver.utxos.toArray()])
            .to([
                new OutputBuilder(gameResolutionBox.value, gameResolutionErgoTree)
                    .addTokens(gameResolutionBox.assets)
                    .setAdditionalRegisters({
                        R4: gameResolutionBox.additionalRegisters.R4,
                        R5: gameResolutionBox.additionalRegisters.R5,
                        // R6 updated to new winner (omitted)
                        R6: SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex(),
                        // R7 stays same or updated? Usually stays same if no period extension needed for simple swap?
                        // Assuming contract copies R7 or updates it. Original R7 has deadline.
                        R7: gameResolutionBox.additionalRegisters.R7,
                        // R8 updated to new resolver? Yes, contract allows any resolver to perform this if they win/improve?
                        // Wait, 'newResolver' is signing. If they improve result, do they become the resolver?
                        // logic usually: anyone can include omitted. If they do, they might stake.
                        // Here we assume newResolver becomes the registered resolver in R8?
                        R8: SColl(SByte, Buffer.from(newResolver.address.getPublicKeys()[0])).toHex(),
                        // R9 Config ID maintained
                        R9: gameResolutionBox.additionalRegisters.R9
                    })
            ])
            // MUST include Config Box for validation of scores (Read TimeWeight from Config)
            .withDataFrom([
                currentWinnerBox,
                omittedParticipantBox,
                ...originalResolver.utxos.toArray(),
                creator.utxos.toArray().find(b => b.boxId === configBoxId)!
            ])
            .sendChangeTo(newResolver.address)
            .payFee(RECOMMENDED_MIN_FEE_VALUE)
            .build();

        const result = mockChain.execute(tx, { signers: [newResolver as any] });
        expect(result).to.be.true;

        const newGameBox = gameResolutionContract.utxos.toArray()[0];
        expect(newGameBox.additionalRegisters.R6).to.equal(SPair(SColl(SByte, secret), SColl(SByte, omittedCommitment)).toHex());
        expect(newGameBox.additionalRegisters.R8).to.equal(SColl(SByte, Buffer.from(newResolver.address.getPublicKeys()[0])).toHex());
    });
});
