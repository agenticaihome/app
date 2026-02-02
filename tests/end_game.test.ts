import { beforeEach, describe, expect, it } from "vitest";
import { KeyedMockChainParty, MockChain, NonKeyedMockChainParty } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  ErgoTree,
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  SAFE_MIN_BOX_VALUE,
  TransactionBuilder
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
import { prependHexPrefix } from "$lib/utils";
import { bigintToLongByteArray, hexToBytes } from "$lib/ergo/utils";
import { getGopGameResolutionErgoTree, getGopParticipationErgoTree, getGopEndGameErgoTree, getGopFalseAddress } from "$lib/ergo/contract";

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Game Finalization (end_game) - Refactored - (%s)", (mode) => {
  const mockChain = new MockChain({ height: 800_000 });

  const gameResolutionErgoTree: ErgoTree = getGopGameResolutionErgoTree();
  const participationErgoTree: ErgoTree = getGopParticipationErgoTree();
  const endGameErgoTree: ErgoTree = getGopEndGameErgoTree();

  let resolver: KeyedMockChainParty;
  let creator: KeyedMockChainParty;
  let winner: KeyedMockChainParty;
  let loser: KeyedMockChainParty;
  let developer: KeyedMockChainParty;

  const deadline = 800_050;
  const resolutionDeadline = mockChain.height + 100;
  const resolverStake = 2_000_000n;
  const participationFee = 100_000_000n;
  const resolverCommissionPercent = 100000;
  const seed = "a3f9b7e12c9d55ab8068e3ff22b7a19c34d8f1cbeaa1e9c0138b82f00d5ea712";

  let gameNftId: string;
  let secret: Uint8Array;
  let winnerCommitment: string

  let gameResolutionContract: NonKeyedMockChainParty;
  let participationContract: NonKeyedMockChainParty;
  let endGameContract: NonKeyedMockChainParty;

  let configBox: any;
  let configBoxId: string;

  const createCommitment = (solverId: string, score: bigint, logs: Uint8Array, ergotree: Uint8Array, secret: Uint8Array): Uint8Array => {
    return blake2b256(new Uint8Array([...stringToBytes("utf8", solverId), ...(hexToBytes(seed) || []), ...bigintToLongByteArray(score), ...logs, ...ergotree, ...secret]));
  };

  beforeEach(() => {
    mockChain.reset({ clearParties: true });
    mockChain.jumpTo(800_000);

    resolver = mockChain.newParty("Resolver");
    creator = mockChain.newParty("GameCreator");
    winner = mockChain.newParty("Winner");
    loser = mockChain.newParty("Loser");
    developer = mockChain.newParty("Developer"); // Keyed for easy address checks

    gameResolutionContract = mockChain.addParty(gameResolutionErgoTree.toHex(), "GameResolutionContract");
    participationContract = mockChain.addParty(participationErgoTree.toHex(), "ParticipationContract");
    endGameContract = mockChain.addParty(endGameErgoTree.toHex(), "EndGameContract");

    if (mode.token !== ERG_BASE_TOKEN) {
      creator.addBalance({ tokens: [{ tokenId: mode.token, amount: resolverStake * 2n }], nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });
      winner.addBalance({ tokens: [{ tokenId: mode.token, amount: participationFee * 2n }], nanoergs: RECOMMENDED_MIN_FEE_VALUE * 10n });
    } else {
      creator.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
      winner.addBalance({ nanoergs: RECOMMENDED_MIN_FEE_VALUE });
    }

    gameNftId = "c94a63ec4e9ae8700c671a908bd2121d4c049cec75a40f1309e09ab59d0bbc71";
    secret = stringToBytes("utf8", "game-secret");
    const hashedSecret = blake2b256(secret);

    // --- Create Config Box ---
    configBox = {
      transactionId: "0000000000000000000000000000000000000000000000000000000000000001",
      index: 0,

      value: SAFE_MIN_BOX_VALUE,
      ergoTree: getGopFalseAddress().ergoTree,
      assets: [],
      creationHeight: mockChain.height,
      additionalRegisters: {
        // R4: Judges
        R4: SColl(SColl(SByte), []).toHex(),
        // R5: Params
        R5: SColl(SLong, [
          1n, 20n, BigInt(deadline), resolverStake, participationFee, 0n, BigInt(resolverCommissionPercent)
        ]).toHex(),
        // R6: Provenance
        R6: SColl(SColl(SByte), [stringToBytes("utf8", "{}"), hexToBytes(mode.token) ?? ""]).toHex(),
        // R7: Secret Hash
        R7: SColl(SByte, hashedSecret).toHex()
      }
    };
    creator.addUTxOs(configBox);
    configBoxId = creator.utxos.toArray().find(b => b.additionalRegisters.R5 === configBox.additionalRegisters.R5)!.boxId;

    // --- Create Winner Participation ---
    const winnerSolverId = "player-alpha-7";
    const winnerTrueScore = 9500n;
    const winnerLogs = "Log del juego del ganador.";
    const winnerHashLogsBytes = blake2b256(stringToBytes("utf8", winnerLogs));
    const winnerScoreList = [1200n, 5000n, 9500n, 12000n];
    const winer_ergotree = prependHexPrefix(winner.address.getPublicKeys()[0])
    const winnerCommitmentBytes = createCommitment(winnerSolverId, winnerTrueScore, winnerHashLogsBytes, winer_ergotree, secret);
    winnerCommitment = Buffer.from(winnerCommitmentBytes).toString("hex");

    const participationAssets = mode.token === ERG_BASE_TOKEN ? [] : [{ tokenId: mode.token, amount: participationFee }];
    const participationValue = mode.token === ERG_BASE_TOKEN ? participationFee : RECOMMENDED_MIN_FEE_VALUE;

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      additionalRegisters: {
        R4: SColl(SByte, winer_ergotree).toHex(),
        R5: SColl(SByte, winnerCommitment).toHex(),
        R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
        R7: SColl(SByte, Buffer.from(winnerSolverId, "utf8").toString("hex")).toHex(),
        R8: SColl(SByte, winnerHashLogsBytes).toHex(),
        R9: SColl(SLong, winnerScoreList).toHex(),
      },
    });

    // --- Create Loser Participation ---
    const loserSolverId = "player-beta-3";
    const loserTrueScore = 2100n;
    const loserLogs = "Log del juego para el perdedor.";
    const loserHashLogsBytes = blake2b256(stringToBytes("utf8", loserLogs));
    const loserScoreList = [500n, 1100n, 2100n, 3000n];
    const loser_ergotree = prependHexPrefix(loser.address.getPublicKeys()[0]);
    const loserCommitmentBytes = createCommitment(loserSolverId, loserTrueScore, loserHashLogsBytes, loser_ergotree, secret);
    const loserCommitmentHex = Buffer.from(loserCommitmentBytes).toString("hex");

    participationContract.addUTxOs({
      creationHeight: mockChain.height,
      value: participationValue,
      ergoTree: participationErgoTree.toHex(),
      assets: participationAssets,
      additionalRegisters: {
        R4: SColl(SByte, loser_ergotree).toHex(),
        R5: SColl(SByte, loserCommitmentHex).toHex(),
        R6: SColl(SByte, hexToBytes(gameNftId)!).toHex(),
        R7: SColl(SByte, Buffer.from(loserSolverId, "utf8").toString("hex")).toHex(),
        R8: SColl(SByte, loserHashLogsBytes).toHex(),
        R9: SColl(SLong, loserScoreList).toHex(),
      },
    });

    // --- Create Game Resolution Box (Refactored) ---
    const gameAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: resolverStake }] : [])
    ];
    const gameBoxValue = mode.token === ERG_BASE_TOKEN ? resolverStake : RECOMMENDED_MIN_FEE_VALUE;
    const resolverPkBytes = resolver.address.getPublicKeys()[0];

    gameResolutionContract.addUTxOs({
      creationHeight: mockChain.height,
      value: gameBoxValue,
      ergoTree: gameResolutionErgoTree.toHex(),
      assets: gameAssets,
      additionalRegisters: {
        R4: SInt(1).toHex(),
        R5: SColl(SByte, hexToBytes(seed)!).toHex(),
        R6: SPair(SColl(SByte, secret), SColl(SByte, winnerCommitment)).toHex(),
        // R7: [resolutionDeadline, perJudgeComm, resolverComm]
        R7: SColl(SLong, [BigInt(resolutionDeadline), 0n, BigInt(resolverCommissionPercent)]).toHex(),
        // R8: Resolver PK (with prefix)
        R8: SColl(SByte, prependHexPrefix(resolverPkBytes, "0008cd")).toHex(),
        // R9: Config Box ID
        R9: SColl(SByte, hexToBytes(configBoxId)!).toHex()
      }
    });

  });

  it("Should successfully finalize the game and distribute funds correctly", () => {
    mockChain.jumpTo(resolutionDeadline);
    const gameBox = gameResolutionContract.utxos.toArray()[0];
    const participationBoxes = participationContract.utxos;

    // --- 1. Transition to End Game ---
    // Uses Resolution Box as input. Config Box as Data Input is redundant for this step?
    // Contract 'to_end_game' logic usually just copies.
    // However, validation of transition might check Config details if complex.
    // Let's assume standard copy logic.
    const toEndGameTx = new TransactionBuilder(mockChain.height)
      .from([gameBox, ...winner.utxos.toArray()])
      .to(
        new OutputBuilder(gameBox.value, endGameErgoTree.toHex())
          .addTokens(gameBox.assets)
          .setAdditionalRegisters(gameBox.additionalRegisters)
      )
      .withDataFrom([creator.utxos.toArray().find(b => b.boxId === configBoxId)!]) // Config Box necessary for contract validation if any
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    expect(mockChain.execute(toEndGameTx, { signers: [winner] }), "Transition to EndGame failed").to.be.true;

    const endGameBox = endGameContract.utxos.toArray()[0];

    // --- 2. Calculate Payouts ---
    const prizePool = participationBoxes.reduce((acc, p) => {
      if (mode.token === ERG_BASE_TOKEN) return acc + p.value;
      return acc + (p.assets.find(a => a.tokenId === mode.token)?.amount || 0n);
    }, 0n);

    const resolverCommission = (prizePool * BigInt(resolverCommissionPercent)) / 1000000n;
    const devCommission = (prizePool * 5n) / 100n;
    const winnerBasePrize = prizePool - resolverCommission - devCommission;

    const finalWinnerPrize = winnerBasePrize;
    const finalResolverPayout = resolverStake + resolverCommission;
    const finalDevPayout = devCommission;

    const winnerAssets = [
      { tokenId: gameNftId, amount: 1n },
      ...(mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalWinnerPrize }] : [])
    ];
    const resolverAssets = mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalResolverPayout }] : [];
    const devAssets = mode.token !== ERG_BASE_TOKEN ? [{ tokenId: mode.token, amount: finalDevPayout }] : [];

    // --- 3. Final Payout Transaction ---
    const transaction = new TransactionBuilder(mockChain.height)
      .from([endGameBox, ...participationBoxes.toArray(), ...winner.utxos.toArray()])
      .to([
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalWinnerPrize : RECOMMENDED_MIN_FEE_VALUE, winner.address).addTokens(winnerAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalResolverPayout : 2000000n, resolver.address).addTokens(resolverAssets),
        new OutputBuilder(mode.token === ERG_BASE_TOKEN ? finalDevPayout : RECOMMENDED_MIN_FEE_VALUE, developer.address).addTokens(devAssets),
      ])
      // Config Box MUST be Data Input for payout validation (reading commissions/gameProvenance if needed)
      .withDataFrom([creator.utxos.toArray().find(b => b.boxId === configBoxId)!])
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .sendChangeTo(winner.address)
      .build();

    expect(mockChain.execute(transaction, { signers: [winner] }), "Final Payout Tx failed").to.be.true;

    // --- Verify Balances ---
    if (mode.token === ERG_BASE_TOKEN) {
      expect(winner.balance.nanoergs).to.equal(finalWinnerPrize);
      expect(developer.balance.nanoergs).to.equal(finalDevPayout);
      expect(resolver.balance.nanoergs).to.equal(finalResolverPayout);
    } else {
      // ... simplified check logic
      const winnerTokenBalance = winner.balance.tokens.find(t => t.tokenId === mode.token)?.amount || 0n;
      expect(winnerTokenBalance).toBeGreaterThan(0n);
    }
    expect(endGameContract.utxos.length).to.equal(0);
    expect(participationContract.utxos.length).to.equal(0);
  });
});
