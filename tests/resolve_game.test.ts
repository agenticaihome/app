import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
  SAFE_MIN_BOX_VALUE
} from "@fleet-sdk/core";
import { SByte, SColl, SLong, SPair, SInt } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { bigintToLongByteArray, hexToBytes } from "$lib/ergo/utils";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameActiveErgoTree, getGopGameResolutionErgoTree, getGopParticipationErgoTree, getGopFalseAddress } from "$lib/ergo/contract";
import { DefaultGameConstants } from "$lib/common/constants";

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

describe.each(baseModes)("Game Resolution (resolve_game) - (%s)", (mode) => {
  let mockChain: MockChain;
  let creator: ReturnType<MockChain["newParty"]>;
  let participant1: ReturnType<MockChain["newParty"]>;

  let gameActiveContract: ReturnType<MockChain["addParty"]>;
  let participationContract: ReturnType<MockChain["addParty"]>;
  let gameResolutionContract: ReturnType<MockChain["addParty"]>;

  const participationSubmittedErgoTree = getGopParticipationErgoTree();
  const gameResolutionErgoTree = getGopGameResolutionErgoTree();
  const gameActiveErgoTree = getGopGameActiveErgoTree();

  let secret: Uint8Array;
  let gameNftId: string;
  const resolver_commission_percentage = 10n;
  const perJudgeCommission = 1n;
  const deadlineBlock = 800_200;
  const participationFee = 1_000_000n;
  const resolverStake = 2_000_000_000n;
  const resolutionDeadline = BigInt(deadlineBlock + DefaultGameConstants.JUDGE_PERIOD + 10);
  let commitment1Hex: string;
  let gameBoxOutput: OutputBuilder;
  let score1: bigint;
  let participation1_registers: Record<string, string>;
  let winnerCandidateCommitment: string;
  const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";

  let configBoxId: string;
  let configBox: any;

  afterEach(() => {
    mockChain.reset({ clearParties: true });
  });

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");
    participant1 = mockChain.newParty("Player1");

    if (mode.token !== ERG_BASE_TOKEN) {
      creator.addBalance({
        tokens: [{ tokenId: mode.token, amount: resolverStake * 2n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n
      });
    } else {
      creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });
    }

    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
    participationContract = mockChain.addParty(participationSubmittedErgoTree.toHex(), "ParticipationContract");
    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");

    secret = stringToBytes("utf8", "the-secret-phrase-for-testing");
    const hashedSecret = blake2b256(secret);
    gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";

    // --- Create Config Box ---
    configBox = {
      transactionId: "0000000000000000000000000000000000000000000000000000000000000001",
      index: 0,

      value: SAFE_MIN_BOX_VALUE,
      ergoTree: getGopFalseAddress().ergoTree, // False script
      assets: [],
      creationHeight: mockChain.height,
      additionalRegisters: {
        // R4: Judges
        R4: SColl(SColl(SByte), []).toHex(),
        // R5: Params
        R5: SColl(SLong, [
          1n, // createdAt
          20n, // timeWeight
          BigInt(deadlineBlock),
          resolverStake,
          participationFee,
          perJudgeCommission,
          resolver_commission_percentage
        ]).toHex(),
        // R6: Provenance
        R6: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
        // R7: Secret Hash
        R7: SColl(SByte, hashedSecret).toHex()
      }
    };
    // Inject config box into chain (creator holds it nominally or just available)
    creator.addUTxOs(configBox); // Add to creator so we can use it (or mock it separately)
    configBoxId = creator.utxos.toArray().find(b => b.additionalRegisters.R5 === configBox.additionalRegisters.R5)!.boxId;

    // --- Create Game Active Box ---
    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    gameActiveContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: gameActiveErgoTree.toHex(),
      assets: gameAssets,
      value: gameBoxValue,
      additionalRegisters: {
        R4: SInt(0).toHex(),
        R5: SColl(SByte, hexToBytes(seed)!).toHex(),
        R6: SColl(SByte, hexToBytes(configBoxId)!).toHex()
      }
    });

    const participantErgotree = prependHexPrefix(participant1.address.getPublicKeys()[0]);
    score1 = 1000n;
    commitment1Hex = uint8ArrayToHex(blake2b256(
      new Uint8Array([...stringToBytes("utf8", "player1-solver"), ...hexToBytes(seed)!, ...bigintToLongByteArray(score1), ...stringToBytes("utf8", "logs1"), ...participantErgotree, ...secret])
    ));
    winnerCandidateCommitment = commitment1Hex;

    // --- Create Helper Solver Box ---
    const solverIdBox = {
      creationHeight: deadlineBlock - DefaultGameConstants.PARTICIPATION_TIME_WINDOW - DefaultGameConstants.SEED_MARGIN - 1,
      ergoTree: "1906010100d17300",
      assets: [],
      value: RECOMMENDED_MIN_FEE_VALUE,
      additionalRegisters: { R4: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex() }
    };
    creator.addUTxOs(solverIdBox);

    // --- Prepare Resolution Box Output ---
    const gameResolutionBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameResolutionAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    // Resolver PK
    const resolverPkBytes = creator.address.getPublicKeys()[0];

    gameBoxOutput = new OutputBuilder(gameResolutionBoxValue, gameResolutionContract.address)
      .addTokens(gameResolutionAssets)
      .setAdditionalRegisters({
        R4: SInt(1).toHex(),
        R5: SColl(SByte, hexToBytes(seed)!).toHex(),
        R6: SPair(SColl(SByte, secret), SColl(SByte, hexToBytes(winnerCandidateCommitment)!)).toHex(),
        R7: SColl(SLong, [
          resolutionDeadline,
          perJudgeCommission,
          resolver_commission_percentage
        ]).toHex(),
        // R8: Resolver PK (with prefix)
        R8: SColl(SByte, prependHexPrefix(resolverPkBytes, "0008cd")).toHex(),
        R9: SColl(SByte, hexToBytes(configBoxId)!).toHex()
      });

    // --- Participation Box ---
    participation1_registers = {
      R4: SColl(SByte, participantErgotree).toHex(),
      R5: SColl(SByte, commitment1Hex).toHex(),
      R6: SColl(SByte, gameNftId).toHex(),
      R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
      R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
      R9: SColl(SLong, [500n, 800n, score1, 1200n]).toHex()
    };
    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      ergoTree: participationSubmittedErgoTree.toHex(),
      assets: participationAssets,
      value: participationValue,
      additionalRegisters: participation1_registers
    });

    mockChain.newBlocks(deadlineBlock - mockChain.height + 1);
  });

  it("should successfully transition the game to the resolution phase", () => {
    // Config Box and Participation Data Inputs 
    // solverIdBox is maintained in creator utxos
    const solverIdBox = creator.utxos.toArray().find(b => b.additionalRegisters.R4 === SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex());

    const tx = new TransactionBuilder(mockChain.height)
      .from([
        gameActiveContract.utxos.toArray()[0],
        ...creator.utxos.toArray().filter(b => b.boxId !== configBoxId && b !== solverIdBox) // Spend funding boxes
      ])
      .to([gameBoxOutput])
      // DataFrom should include: ConfigBox, Participation, SolverBox
      .withDataFrom([
        creator.utxos.toArray().find(b => b.boxId === configBoxId)!,
        participationContract.utxos.toArray()[0],
        solverIdBox!
      ])
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [creator] });
    expect(executionResult).to.be.true;
  });

  // Additional failure tests (skipped for brevity but follow same pattern of modifying input registers/values)
});
