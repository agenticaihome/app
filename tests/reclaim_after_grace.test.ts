import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockChain } from "@fleet-sdk/mock-chain";
import {
  Box,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
  SAFE_MIN_BOX_VALUE
} from "@fleet-sdk/core";
import { SByte, SColl, SInt, SLong, SPair } from "@fleet-sdk/serializer";
import { blake2b256 } from "@fleet-sdk/crypto";
import { stringToBytes } from "@scure/base";
import { prependHexPrefix } from "$lib/utils";
import { DefaultGameConstants } from "$lib/common/constants";
import { getGopGameActiveErgoTree, getGopParticipationErgoTree, getGopFalseAddress } from "$lib/ergo/contract";
import { hexToBytes } from "$lib/ergo/utils";


const GRACE_PERIOD = DefaultGameConstants.PARTICIPATION_GRACE_PERIOD;

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Participant Reclaim After Grace Period (Refactored) - (%s)", (mode) => {
  let mockChain: MockChain;
  let creator: ReturnType<MockChain["newParty"]>;
  let participant: ReturnType<MockChain["newParty"]>;
  let gameActiveContract: ReturnType<MockChain["newParty"]>;
  let participationContract: ReturnType<MockChain["newParty"]>;
  let gameActiveBox: Box;
  let participationBox: Box;
  let configBox: any;
  let configBoxId: string;

  const resolverStake = 1_000_000_000n;
  const participationFee = 1_000_000_000n;
  const deadlineBlock = 800_200;

  const gameNftId = "fad58de3081b83590551ac9e28f3657b98d9f1c7842628d05267a57f1852f417";

  const participationErgoTree = getGopParticipationErgoTree();
  const gameActiveErgoTree = getGopGameActiveErgoTree();

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");
    participant = mockChain.newParty("Participant");

    if (mode.token !== ERG_BASE_TOKEN) {
      participant.addBalance({
        tokens: [{ tokenId: mode.token, amount: participationFee * 2n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n
      });
    } else {
      participant.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE * 2n });
    }

    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActive");
    participationContract = mockChain.addParty(participationErgoTree.toHex(), "Participation");

    // --- Create Config Box ---
    // Must contain proper Params to determine deadline
    // And must use the False Script Address so hash matches contract
    const falseAddress = getGopFalseAddress(0); // 0 = Mainnet/Testnet doesn't matter for mock execution usually, but consistent

    // R5: Params [createdAt, timeWeight, DEADLINE, ...]
    const params = [
      BigInt(mockChain.height),
      20n,
      BigInt(deadlineBlock),
      resolverStake,
      participationFee,
      500n,
      1000n
    ];

    configBox = {
      transactionId: "0000000000000000000000000000000000000000000000000000000000000001",
      index: 0,

      value: SAFE_MIN_BOX_VALUE,
      ergoTree: falseAddress.ergoTree, // MUST BE FALSE SCRIPT
      assets: [],
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SColl(SColl(SByte), []).toHex(),
        R5: SColl(SLong, params).toHex(),
        R6: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
        R7: SColl(SByte, blake2b256(stringToBytes("utf8", "secret"))).toHex()
      }
    };
    // We add it to 'creator' or simply inject it as data input references
    creator.addUTxOs(configBox);
    configBoxId = creator.utxos.toArray().find(b => b.additionalRegisters.R5 === configBox.additionalRegisters.R5)!.boxId;

    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];

    gameActiveContract.addUTxOs({
      value: gameBoxValue,
      ergoTree: gameActiveErgoTree.toHex(),
      assets: gameAssets,
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SInt(0).toHex(),
        R5: SColl(SByte, stringToBytes("utf8", "seed-for-ceremony")).toHex(), // Seed
        R6: SColl(SByte, hexToBytes(configBoxId)!).toHex()
      },
    });

    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;
    const participationAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    participationContract.addUTxOs({
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      creationHeight: mockChain.height,
      additionalRegisters: {
        R4: SColl(SByte, prependHexPrefix(participant.address.getPublicKeys()[0])).toHex(),
        R5: SColl(SByte, "aa".repeat(32)).toHex(),
        R6: SColl(SByte, gameNftId).toHex(),
        R7: SColl(SByte, "bb".repeat(8)).toHex(),
        R8: SColl(SByte, "cc".repeat(32)).toHex(),
        R9: SColl(SLong, [100n, 200n]).toHex(),
      },
    });

    gameActiveBox = gameActiveContract.utxos.toArray()[0];
    participationBox = participationContract.utxos.toArray()[0];
  });

  afterEach(() => {
    mockChain.reset({ clearParties: true });
  });

  it("should allow a participant to reclaim funds if the grace period has passed", () => {
    const reclaimHeight = deadlineBlock + GRACE_PERIOD;
    mockChain.jumpTo(reclaimHeight);

    const reclaimValue = mode.token === ERG_BASE_TOKEN ? participationBox.value : RECOMMENDED_MIN_FEE_VALUE;
    const reclaimAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    const reclaimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...participant.utxos.toArray()])
      // Must include GameActive AND ConfigBox so contract can find deadline
      .withDataFrom([
        gameActiveBox,
        creator.utxos.toArray().find(b => b.boxId === configBoxId)!
      ])
      .to(new OutputBuilder(reclaimValue, participant.address).addTokens(reclaimAssets))
      .sendChangeTo(participant.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(reclaimTx, { signers: [participant as any] });
    expect(executionResult).to.be.true;
  });

  it("should FAIL to reclaim funds if the grace period has NOT passed", () => {
    const reclaimHeight = deadlineBlock + GRACE_PERIOD - 10;
    mockChain.jumpTo(reclaimHeight);

    const reclaimValue = mode.token === ERG_BASE_TOKEN ? participationBox.value : RECOMMENDED_MIN_FEE_VALUE;
    const reclaimAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];

    const reclaimTx = new TransactionBuilder(mockChain.height)
      .from([participationBox, ...participant.utxos.toArray()])
      .withDataFrom([
        gameActiveBox,
        creator.utxos.toArray().find(b => b.boxId === configBoxId)!
      ])
      .to(new OutputBuilder(reclaimValue, participant.address).addTokens(reclaimAssets))
      .sendChangeTo(participant.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const executionResult = mockChain.execute(reclaimTx, { signers: [participant as any], throw: false });
    expect(executionResult).to.be.false;
  });
});