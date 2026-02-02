import { beforeEach, describe, expect, it } from "vitest";
import { KeyedMockChainParty, MockChain } from "@fleet-sdk/mock-chain";
import { compile } from "@fleet-sdk/compiler";
import {
  OutputBuilder,
  RECOMMENDED_MIN_FEE_VALUE,
  TransactionBuilder,
  BOX_VALUE_PER_BYTE,
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
import { getGopGameActiveErgoTree, getGopFalseAddress, getGopFalseErgoTreeHex } from "$lib/ergo/contract";

// Helper for hex
const stripHexPrefix = (h: string) => h?.startsWith('0x') ? h.slice(2) : h;
const hexBytesLen = (hexStr: string) => hexStr ? Math.ceil(stripHexPrefix(hexStr).length / 2) : 0;

// --- Test Suite ---

const ERG_BASE_TOKEN = "";
const ERG_BASE_TOKEN_NAME = "ERG";
const USD_BASE_TOKEN = "ebb40ecab7bb7d2a935024100806db04f44c62c33ae9756cf6fc4cb6b9aa2d12";
const USD_BASE_TOKEN_NAME = "USD";

const baseModes = [
  { name: "USD Token Mode", token: USD_BASE_TOKEN, tokenName: USD_BASE_TOKEN_NAME },
];

describe.each(baseModes)("Game Creation (Refactored Architecture) - (%s)", (mode) => {
  let mockChain: MockChain;
  let creator: KeyedMockChainParty;
  let gameActiveContract: ReturnType<MockChain["newParty"]>;
  let gameActiveErgoTree: ReturnType<typeof compile>;

  gameActiveErgoTree = getGopGameActiveErgoTree();

  beforeEach(() => {
    mockChain = new MockChain({ height: 800_000 });
    creator = mockChain.newParty("GameCreator");

    if (mode.token !== ERG_BASE_TOKEN) {
      creator.addBalance({
        tokens: [{ tokenId: mode.token, amount: 10_000_000_000n }],
        nanoergs: RECOMMENDED_MIN_FEE_VALUE * 20n // More funds for multiple txs
      });
    } else {
      creator.addBalance({ nanoergs: 10_000_000_000n });
    }

    gameActiveContract = mockChain.addParty(gameActiveErgoTree.toHex(), "GameActiveContract");
    mockChain.addParty(getGopFalseErgoTreeHex(), "FalseParty");
  });

  it("Should successfully create a Configuration Box and then a Game Box referencing it", () => {
    // --- 1. Prepare Data ---
    const deadlineBlock = mockChain.height + 200;
    const resolverStake = 2_000_000_000n;
    const participationFee = 1_000_000n;
    const gameDetailsJson = JSON.stringify({ title: "New Test Game", desc: "Refactored." });
    const secret = stringToBytes("utf8", "super-secret-phrase");
    const hashedSecret = blake2b256(secret);

    // --- 2. Step 1: Create Config Box ---
    // Registers for Config Box
    // R4: Invited Judges (Coll[Coll[Byte]])
    // R5: Numerical Params (Coll[Long])
    // R6: Game Provenance (Coll[Coll[Byte]])
    // R7: Secret Hash (Coll[Byte])

    const configR4 = SColl(SColl(SByte), []).toHex(); // No judges

    // Params: [createdAt, timeWeight, deadline, resolverStake, participationFee, perJudgeComm, resolverComm]
    const configR5 = SColl(SLong, [
      BigInt(mockChain.height), // createdAt
      100000n,                  // timeWeight
      BigInt(deadlineBlock),
      resolverStake,
      participationFee,
      50n, // perJudgeComm
      100n // resolverComm
    ]).toHex();

    // Provenance: [rawJson, participationTokenId, resolverScript(?)] 
    // Note: implementation details might vary slightly on exact content of provenance but structure is Coll[Coll[Byte]]
    const configR6 = SColl(SColl(SByte), [
      stringToBytes("utf8", gameDetailsJson),
      stringToBytes("utf8", "") // participationTokenId
    ]).toHex();

    const configR7 = SColl(SByte, hashedSecret).toHex();

    // False script for config box (unspendable essentially for test)
    // In real app we use getGopFalseAddress(). Here we can use a dummy or creator for test logic, 
    // but better to use a random P2S to mimic unspendable nature if needed, or just creator.
    // Let's use creator's address but with registers.
    const configBoxOutput = new OutputBuilder(SAFE_MIN_BOX_VALUE, getGopFalseErgoTreeHex())
      .setAdditionalRegisters({
        R4: configR4,
        R5: configR5,
        R6: configR6,
        R7: configR7
      });

    const tx1 = new TransactionBuilder(mockChain.height)
      .from(creator.utxos)
      .to(configBoxOutput)
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const tx1Res = mockChain.execute(tx1, { signers: [creator] });
    expect(tx1Res).to.be.true;

    // Get Config Box ID
    let allBoxes = mockChain.parties.flatMap(p => p.utxos.toArray());
    const configBox = allBoxes.find(b => b.additionalRegisters.R5 === configR5);

    expect(configBox).toBeDefined();
    const configBoxId = configBox!.boxId;
    const configBoxIdBytes = stringToBytes("hex", configBoxId);

    // --- 3. Step 2: Mint Game NFT ---
    // We spend the change from Tx1 to mint.
    // Input for minting must be deterministic.
    const changeBoxTx1 = allBoxes.find(b => b.transactionId === configBox!.transactionId && b.boxId !== configBox!.boxId);
    if (!changeBoxTx1) {
      console.log("Actual Tx1 ID:", configBox!.transactionId);
      console.log("Boxes with this Tx ID:", allBoxes.filter(b => b.transactionId === configBox!.transactionId).map(b => ({ id: b.boxId, tree: b.ergoTree, val: b.value })));
      console.log("Creator ErgoTree:", creator.ergoTree);
    }
    expect(changeBoxTx1).toBeDefined();

    const nftMintOutput = new OutputBuilder(SAFE_MIN_BOX_VALUE, creator.address)
      .mintToken({ amount: 1n, name: "Game NFT" });

    const tx2 = new TransactionBuilder(mockChain.height)
      .from(changeBoxTx1!)
      .to(nftMintOutput)
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const tx2Res = mockChain.execute(tx2, { signers: [creator] });
    expect(tx2Res).to.be.true;

    // Get the Mint Box
    allBoxes = mockChain.parties.flatMap(p => p.utxos.toArray());
    const mintBox = allBoxes.find(b => b.assets.length > 0 && b.assets[0].amount === 1n);
    expect(mintBox).toBeDefined();
    const gameNftId = mintBox!.assets[0].tokenId;


    // --- 4. Step 3: Create Game Box ---
    // Uses Mint Box + Funds. References Config Box ID in R6.

    const r4Hex = SInt(0).toHex(); // State: Active
    const r5Hex = SColl(SByte, stringToBytes("utf8", "seed-for-ceremony")).toHex(); // Seed
    const r6Hex = SColl(SByte, configBoxIdBytes).toHex(); // CONFIG BOX ID

    const gameBoxOutput = new OutputBuilder(resolverStake, gameActiveErgoTree) // Value = stake (if ERG mode) or Min
      .addTokens(mintBox!.assets) // Add NFT
      .setAdditionalRegisters({
        R4: r4Hex,
        R5: r5Hex,
        R6: r6Hex
      });

    if (mode.token !== ERG_BASE_TOKEN) {
      // Add stake token
      gameBoxOutput.addTokens([{ tokenId: mode.token, amount: resolverStake }]);
    }

    const tx3 = new TransactionBuilder(mockChain.height)
      .from(mintBox!) // Spend the mint box
      .from(creator.utxos) // And other funds
      .to(gameBoxOutput)
      .sendChangeTo(creator.address)
      .payFee(RECOMMENDED_MIN_FEE_VALUE)
      .build();

    const tx3Res = mockChain.execute(tx3, { signers: [creator] });
    expect(tx3Res).to.be.true; // Success

    // --- 5. Verify Output ---
    expect(gameActiveContract.utxos.length).to.equal(1);
    const createdGameBox = gameActiveContract.utxos.toArray()[0];

    // Check Registers
    expect(createdGameBox.additionalRegisters.R4).to.equal(r4Hex);
    expect(createdGameBox.additionalRegisters.R5).to.equal(r5Hex);
    expect(createdGameBox.additionalRegisters.R6).to.equal(r6Hex); // Matches configBoxId

    // Check Assets
    expect(createdGameBox.assets[0].tokenId).to.equal(gameNftId);

    // Verify R6 points to an existing box? (Conceptually yes, physically it's just bytes)
    // The contract logic (Action 1..n) will enforce checking this ID in DataInputs upon spending.
  });
});