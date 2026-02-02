import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
  SAFE_MIN_BOX_VALUE
} from "@fleet-sdk/core";
import { SByte, SColl, SLong, SInt } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { prependHexPrefix } from "$lib/utils";
import { getGopGameCancellationErgoTree, getGopParticipationErgoTree } from "$lib/ergo/contract";
import { hexToBytes } from "$lib/ergo/utils";

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Participation Contract: Refund after Game Cancellation (Refactored) - (%s)", (mode) => {
  let mockChain: MockChain;

  const participationErgoTree = getGopParticipationErgoTree();
  const gameCancellationErgoTree = getGopGameCancellationErgoTree();

  let player: ReturnType<MockChain["newParty"]>;
  let creator: ReturnType<MockChain["newParty"]>;

  let participationContract: ReturnType<MockChain["addParty"]>;
  let gameCancelledContract: ReturnType<MockChain["addParty"]>;

  let gameNftId: string;
  const participationFee = 1_000_000n;
  const creatorInitialStake = 2_000_000_000n;

  let configBox: any;
  let configBoxId: string;

  afterEach(() => {
    mockChain.reset({ clearParties: true });
  });

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });

    player = mockChain.newParty("PlayerToRefund");
    creator = mockChain.newParty("GameCreator");

    if (mode.token !== ERG_BASE_TOKEN) {
      player.addBalance({ tokens: [{ tokenId: mode.token, amount: participationFee * 2n }], nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });
    } else {
      player.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
    }

    participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationContract");
    gameCancelledContract = mockChain.addParty(gameCancellationErgoTree.toHex(), "GameCancelledContract");

    gameNftId = "a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1";
    const secret = stringToBytes("utf8", "the-secret-was-revealed");

    // --- Create Config Box (Needed for consistency) ---
    configBox = {
      transactionId: "0000000000000000000000000000000000000000000000000000000000000001",
      index: 0,

      value: SAFE_MIN_BOX_VALUE,
      ergoTree: creator.ergoTree,
      assets: [],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SColl(SColl(SByte), []).toHex(),
        R5: SColl(SLong, [1n, 20n, 1n, creatorInitialStake, participationFee, 500n, 1000n]).toHex(),
        R6: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
        R7: SColl(SByte, blake2b256(secret)).toHex()
      }
    };
    creator.addUTxOs(configBox);
    configBoxId = creator.utxos.toArray().find(b => b.additionalRegisters.R5 === configBox.additionalRegisters.R5)!.boxId;

    // --- Create Cancelled Game Box ---
    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? creatorInitialStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: creatorInitialStake }] : [])
    ];

    gameCancelledContract.addUTxOs({
      creationHeight: mockChain.height - 100,
      ergoTree: gameCancellationErgoTree.toHex(),
      assets: gameAssets,
      value: gameBoxValue,
      additionalRegisters: {
        R4: SInt(2).toHex(), // Cancelled
        R5: SLong(BigInt(mockChain.height - 50)).toHex(),
        R6: SColl(SByte, secret).toHex(), // Secret revealed
        R7: SLong(creatorInitialStake).toHex(), // Value left
        R8: SLong(BigInt(mockChain.height)).toHex(), // Deadline
        // R9: Config Box ID (Refactored)
        R9: SColl(SByte, hexToBytes(configBoxId)!).toHex()
      }
    });

    // --- Create Participation Box ---
    const playerPkBytes = player.address.getPublicKeys()[0];
    const dummyCommitment = blake2b256(stringToBytes("utf8", "dummy-commitment"));
    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    participationContract.addUTxOs({
      creationHeight: mockChain.height - 90,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      value: participationValue,
      additionalRegisters: {
        R4: SColl(SByte, prependHexPrefix(playerPkBytes)).toHex(),
        R5: SColl(SByte, dummyCommitment).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, stringToBytes("utf8", "player1-solver")).toHex(),
        R8: SColl(SByte, stringToBytes("utf8", "logs1")).toHex(),
        R9: SColl(SLong, [500n, 800n, 1000n, 1200n]).toHex()
      }
    });
  });

  it("should allow a player to claim a refund if the game is cancelled", () => {
    const refundValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const refundAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    const participationBoxToSpend = participationContract.utxos.toArray()[0];
    const gameCancelledBoxAsData = gameCancelledContract.utxos.toArray()[0];

    // Transaction includes Config Box as Data Input for consistency, though contract might not strictly demand it for this path
    const tx = new TransactionBuilder(mockChain.height)
      .from([participationBoxToSpend, ...player.utxos.toArray()])
      .withDataFrom([
        gameCancelledBoxAsData,
        creator.utxos.toArray().find(b => b.boxId === configBoxId)!
      ])
      .to([new OutputBuilder(refundValue, player.address).addTokens(refundAssets)])
      .sendChangeTo(player.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(tx, { signers: [player as any] });
    expect(executionResult).to.be.true;
  });
});