# Game of Prompts — Combined Contract Security Audit

**Date:** 2026-04-21  
**Scope:** All 9 ErgoScript contracts in `contracts/`  
**Commit:** `b85407306f172e1800fae30ae39b7589bffe4e54`  
**Auditors:**  
- Larry (Claude Opus 4.7) — full static analysis + off-chain constant review  
- Claude Opus 4.6 — independent line-by-line review  

**Methodology:** Two independent AI-assisted audits run in parallel, then combined. Cross-referenced every register access against layout comments, traced value preservation for both token and ERG denomination paths, modeled quorum math, and checked auth gates on all spending actions. Off-chain builders (`src/lib/ergo/actions/*.ts`) consulted for box-layout hints only.

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 4 |
| High | 4 |
| Medium | 8 |
| Low | 6 |
| Info | 5 |

The contract suite implements a creative 3-state game lifecycle (ACTIVE / RESOLUTION / CANCELLED_DRAINING) with time-weighted scoring, commit-reveal secret, judge arbitration, and multi-party payout. The architecture is thoughtful and well-designed. However, a systemic `box_value` bug silently breaks ERG-denominated games across 4 contracts, the resolver role has excessive unilateral power (commission inflation, batch drain, empty-winner cashout), and several register-index mismatches between contracts create real exploit vectors.

---

## Critical

### C-01: `box_value` returns 0 for ERG-denominated games, collapsing every value-preservation check

**Files:** `game_active.es:85-87`, `game_resolution.es:70-72`, `game_cancellation.es:57-62`, `judges_paid.es:20-22`  
**Found by:** Both auditors independently

Four contracts define `box_value` as `box.tokens.filter(_._1 == participationTokenId).fold(0L, ...)` with **no fallback to `box.value`** when `participationTokenId == Coll[Byte]()`. Only `end_game.es:63-69` includes the correct dual-mode branch.

When `participationTokenId` is empty (ERG game), `box_value()` returns `0` for every box:

- `game_active.es action3:` `sameOrAddedValue` passes vacuously (0 >= 0) — ERG drainable during seed ceremony
- `game_active.es action2:` Cancellation value goes negative — any output value passes
- `game_resolution.es:` All fund-return checks pass vacuously
- `game_cancellation.es:` Drain invariants broken

**Impact:** Complete theft of game-box ERG balance at multiple lifecycle points in any ERG-denominated game.

**Fix:** Replicate `end_game.es` pattern everywhere:
```
val box_value = { (box: Box) =>
  if (participationTokenId.size == 0) box.value
  else box.tokens.filter(_._1 == participationTokenId).fold(0L, ...)
}
```
Or reject `participationTokenId == Coll[Byte]()` at game creation.

---

### C-02: `judges_paid.es` spendable by anyone when `participationTokenId` is empty

**File:** `judges_paid.es:20-22, 32-98`  
**Found by:** Larry

`total_funds = box_value(SELF)` uses the broken `box_value` from C-01. When `participationTokenId == Coll[Byte]()`, `total_funds = 0`, so the guard falls through to `sigmaProp(true)`:

```
if (total_funds > 0L && judge_amount > 0) { ... judge checks ... }
else { sigmaProp(true) }   // <-- anyone can spend
```

**Impact:** All judge commission ERG stolen on ERG-based games. Patching C-01 fixes this; additionally tighten the fallback to `sigmaProp(false)`.

---

### C-03: `participation.spentInBatch` does not constrain target box to `participation_batch` script

**File:** `participation.es:143-147`  
**Found by:** Larry

The batching-target filter only requires the output be **different from** the participation script and have `R6 == gameNftId`:

```
val targetBoxes = OUTPUTS.filter({ (b:Box) =>
    b.propositionBytes != SELF.propositionBytes &&
    b.R6[Coll[Byte]].isDefined && b.R6[Coll[Byte]].get == gameNftIdInSelf
})
```

By contrast, `participation_batch.es:38-41` correctly requires `b.propositionBytes == SELF.propositionBytes`.

**Impact:** After resolution, the resolver (or winner) can batch-drain all participation-fee tokens to any arbitrary script they control, bypassing the entire `end_game` payout schedule.

**Fix:** Change filter to `blake2b256(b.propositionBytes) == PARTICIPATION_BATCH_SCRIPT_HASH`.

---

### C-04: Resolver can inflate `resolverCommissionPercentage` during resolution transition

**File:** `game_active.es:215`  
**Found by:** Both auditors independently

Every other numerical parameter is checked with `==`, but this one uses `>=`:

```
resolutionBox.R8[Coll[Long]].get(5) == perJudgeCommissionPercentage &&
resolutionBox.R8[Coll[Long]].get(6) >= resolverCommissionPercentage &&   // <-- only >=
resolutionBox.R8[Coll[Long]].get(7) == devCommissionPercentage &&
```

The resolver constructs this transaction and can set `resolverCommissionPercentage = COMMISSION_DENOMINATOR` (100%). This also enables denial of dev + judge fees even in the happy path (when `end_game.es` safety clause zeroes all commissions to protect the winner).

**Fix:** Change `>=` to `==`.

---

## High

### H-01: Empty `winnerCandidateCommitment` lets resolver cash out the entire pool

**Files:** `game_active.es:137`, `end_game.es:283-302`  
**Found by:** Larry

`action1_transitionToResolution` permits `winnerCandidateCommitment == Coll[Byte]()`. If no one calls `action1_includeOmittedParticipation` before `resolutionDeadline`, `action4_endGame` falls into CASO 2 and pays the **entire pool + stake** to `resolverPK`.

**Impact:** A malicious resolver can transition with no winner, grief/front-run omitted participation submissions, wait for `resolutionDeadline`, and collect the full pool.

**Fix:** Block CASO 2 if `participations.size > 0`, or require a long grace period with no participations before allowing no-winner payout.

---

### H-02: Long overflow in time-weighted scoring formula

**File:** `game_resolution.es:253-254`  
**Found by:** Larry

```
val newScoreAdjusted = newScore * (1L + (timeWeight * (deadline - newBotHeight)))
```

Unchecked `Long` multiplication. With large `timeWeight` or adversarial score lists, the product wraps, allowing a colluding participant to manipulate winner selection.

**Fix:** Cap scores and time-weight products with explicit bounds, compare separately, or use `BigInt`.

---

### H-03: `RESOLVER_OMISSION_NO_PENALTY_PERIOD = 5` enables resolver-PK hijack within minutes

**Files:** `game_resolution.es:296-299`, `constants.ts:36`  
**Found by:** Larry

The resolver-replacement guard allows anyone to install their own pubkey as resolver after just 5 blocks (~10 minutes). Since `resolutionDeadline = creationHeight + JUDGE_PERIOD`, the cutoff is effectively `creationHeight + 5`.

**Impact:** Attacker can steal the resolver role (and its commission) by calling `action1_includeOmittedParticipation` with their own PK after block `H + 6`.

**Fix:** Set `RESOLVER_OMISSION_NO_PENALTY_PERIOD >= JUDGE_PERIOD / 2` or require judge-majority approval for resolver swap.

---

### H-04: Judge quorum computed from invited list, not actual participants

**Files:** `game_active.es:182-201, 208`  
**Found by:** Larry

The resolution box's `R7` is hard-required to equal the original `invitedJudges` list, not the subset that actually accepted. Quorum = `invitedJudges.size / 2 + 1`. If only 1 of 5 invited judges accepts, quorum requires 3 — invalidation is permanently unreachable.

**Impact:** In realistic deployments with low acceptance rates, the judge safety net is dead.

**Fix:** Reduce `R7` to `judgeProofDataInputs.map(_.tokens(0)._1)` (accepted set). Optionally enforce minimum acceptance rate.

---

## Medium

### M-01: Wrong register index for `resolutionDeadline` in participation contracts

**Files:** `participation.es:~101, ~116`, `participation_batch.es:~122`  
**Found by:** Claude Opus 4.6

Both contracts read:
```
val resolutionDeadline = mainGameBox.R8[Coll[Long]].get(7)
```

But the resolution/end_game R8 layout is:
```
[0:createdAt, 1:timeWeight, 2:deadline, 3:resolverStake, 4:participationFee,
 5:perJudgeCommission, 6:resolverCommission, 7:devCommissionPercentage, 8:resolutionDeadline]
```

Index 7 = `devCommissionPercentage` (small number like 500), not `resolutionDeadline` (block height ~1,200,000).

**Consequences:**
- `isValidEndGame`: `HEIGHT >= devCommissionPercentage` is always true — participation boxes allow end-game spending before the actual resolution deadline (masked by game_resolution.es checks)
- `isInvalidatedByJudges`: `HEIGHT < devCommissionPercentage` is always false — **this entire action path is dead code**

**Fix:** Change `get(7)` to `get(8)`.

---

### M-02: Zero-judge games permit unauthenticated invalidation loops

**File:** `game_resolution.es:142-143`  
**Found by:** Larry

When `participatingJudges.size == 0`, `requiredVotes = 0` and `judgeVotes.size >= 0` is always true. Combined with H-01, a 0-judge creator has a deterministic path to the full prize pool via repeated invalidation then CASO 2.

**Fix:** Require `participatingJudges.size >= MIN_JUDGES` or short-circuit with `sigmaProp(false)` when 0.

---

### M-03: `action1_includeOmittedParticipation` has no authentication

**File:** `game_resolution.es:190-310`  
**Found by:** Larry

Anyone can call this action — no signer check. Combined with H-03 (resolverPK replacement after 5 blocks), this is a griefing and resolver-hijack vector.

**Fix:** Require caller to sign as the new winner PK, or charge a replacement bond.

---

### M-04: Pre-committed solver IDs via `FALSE_SCRIPT_HASH` boxes are unlinked to identity

**Files:** `game_active.es:89-112`, `game_resolution.es:89-113`  
**Found by:** Larry

Any box with `propositionBytes == FALSE script` and `R4 == solverId` is accepted as proof. Anyone can pre-publish thousands of FALSE boxes at low heights with random `R4` values, then pick whichever maximizes `(deadline - botHeight)` for maximum adjusted score.

**Fix:** Bind FALSE box `R4` to a signature or include the game NFT ID to force per-game registration.

---

### M-05: Participation batching authenticates dev instead of resolver

**Files:** `participation.es:~140`, `participation_batch.es:~36`  
**Found by:** Claude Opus 4.6

During batching, `resolverPK` is read as `gameProvenance(2)`, but the resolution box R9 layout is:
```
[0:gameDetailsJsonHex, 1:ParticipationTokenID, 2:devScript, 3:resolverErgoTree]
```

Index 2 = `devScript`, not `resolverErgoTree` (index 3).

**Impact:** Batch `resolverAuth` authenticates the dev address. The resolver cannot authorize batching; only the dev (or winner) can.

**Fix:** Change `gameProvenance(2)` to `gameProvenance(3)`.

---

### M-06: `participation_batch.isValidEndGame` trusts game box by token only, no script check

**Files:** `participation_batch.es:116-128`, `participation.es:95-107`  
**Found by:** Larry

`isValidEndGame` identifies the game box by token (`tokens(0)._1 == gameNftIdInSelf`) without verifying the box lives at `END_GAME_SCRIPT_HASH`. Currently unexploitable because P2PK outputs don't set typed registers, but fragile against future changes.

**Fix:** Add `blake2b256(b.propositionBytes) == END_GAME_SCRIPT_HASH` to the filter.

---

### M-07: `isInvalidatedByJudges` is dead code in `participation.es`

**File:** `participation.es:110-126`  
**Found by:** Claude Opus 4.6

Direct consequence of M-01 (wrong register index). Since `HEIGHT < devCommissionPercentage` is always false, this action path never fires. Judge invalidation of participation boxes works only accidentally (via `isValidEndGame` path which is trivially true post-resolution).

**Impact:** Participation boxes have no self-protection after resolution — relying entirely on upstream contracts.

**Fix:** Covered by M-01 fix (change index 7 to 8).

---

### M-08: Resolver-commission `>=` also enables denial of dev + judge fees in happy path

**File:** `game_active.es:215`  
**Found by:** Larry

Same construct as C-04. In the winner-exists path, setting `resolverCommissionPercentage = DENOMINATOR` triggers `end_game.es` safety clause which zeroes `adjustedDevPayout` and `adjustedJudgesPayout`. Winner is protected, but dev and judges get nothing.

**Fix:** Covered by C-04 fix (change `>=` to `==`).

---

## Low

### L-01: Winner prize adjustment zeroes ALL commissions

**File:** `end_game.es:228-234`  
**Found by:** Claude Opus 4.6

When `tentativeWinnerPrize < participationFee`, the winner receives the entire `prizePool` with all commissions zeroed. In low-participation or high-commission scenarios, dev, judges, and resolver receive nothing despite doing their work. Documented in comments; appears intentional as a "no net loss" guarantee.

---

### L-02: Commission multiplication can overflow for large pools

**File:** `end_game.es:176-180`  
**Found by:** Larry

`prizePool * dev_commission_percentage / COMMISSION_DENOMINATOR` — with large pools (~1M ERG) the product overflows Long. Unlikely in practice.

**Fix:** Divide first: `prizePool / COMMISSION_DENOMINATOR * percentage`, or enforce `prizePool <= MAX_POOL`.

---

### L-03: Stuck dust below `STAKE_DENOMINATOR` in cancellation

**Files:** `game_active.es:256`, `game_cancellation.es:63-64`  
**Found by:** Larry

When remaining value < `STAKE_DENOMINATOR`, `portionToClaim = 0` and drain is a no-op. Documented in `POINTS_OF_FAILURE.md`.

---

### L-04: Time-based auth switching in `end_game` prevents cooperative early finalization

**File:** `end_game.es:143-153`  
**Found by:** Claude Opus 4.6

`authorizedToEnd` switches between winner and resolver based on time (not OR) due to a Sigma proof composition limitation. If the winner misses the grace period, the resolver takes control. Commented-out `winnerAuth || resolverAuth` shows this was intended but hit an ErgoScript limitation.

---

### L-05: Integer division dust in judge payouts

**File:** `judges_paid.es:34`  
**Found by:** Both auditors

`perJudgeComission = total_funds / judge_amount` loses remainder (up to `judge_amount - 1` units) to the transaction executor. Economically negligible for most games.

---

### L-06: Game NFT permanently locked in drained cancellation boxes

**File:** `game_cancellation.es`  
**Found by:** Claude Opus 4.6

No "final drain" action releases the NFT. Likely intentional (NFT as immutable record), but worth noting if NFTs are scarce.

---

## Informational

### I-01: `participatingJudges` should be named `invitedJudges` in resolution contracts

**File:** `game_resolution.es:45`  
**Found by:** Larry

Resolution R7 is copied from `invitedJudges` in game_active, but called `participatingJudges` — misleading.

---

### I-02: Commitment pre-image concatenation is not length-prefixed

**Found by:** Larry

Components (`solverId`, `gameSeed`, `hashLogs`, `pBoxErgotree`, `secret`) are variable-length. Collisions prevented only because callers happen to use fixed 32-byte lengths — no on-chain enforcement.

**Recommendation:** Enforce `solverId.size == 32`, `hashLogs.size == 32`, etc.

---

### I-03: `action3_add_randomness` — miner can brute-force seed

**File:** `game_active.es:299-339`  
**Found by:** Larry

Last re-randomizer controls `INPUTS(0).id`. A miner can brute-force a favorable seed. `SEED_MARGIN = 20` blocks helps but doesn't eliminate. Documented design trade-off.

---

### I-04: Inconsistent height comparison operators

**File:** `game_resolution.es:293`  
**Found by:** Claude Opus 4.6

Resolver takeover uses strict `<` while most other deadline checks use `>=` / `<` consistently. Potential off-by-one at boundary block.

---

### I-05: Spanish-language comments reduce auditability

**All files**  
**Found by:** Claude Opus 4.6

Contract comments are primarily in Spanish. English or bilingual comments would reduce friction for external audits. Not a security issue.

---

## Architectural Observations

- **Centralization on resolver:** The resolver has power to choose whether to declare a winner, inflate commission, drain via batch, and collect the pool via CASO 2. The judge escape hatch is weakened by H-04 (aspirational quorum) and M-02 (zero-judge games). **Recommendation:** require resolver to post a bond proportional to prizePool, slashable by judge quorum.

- **ERG vs. token dual-denomination:** Half-implemented ERG path (correct in `end_game.es`, broken in 4 other contracts). Should be fully implemented or removed.

- **Off-chain trust assumptions:** Canary/decoy resource enforcement, creator secret generation honesty, and scoring function correctness are not chain-verifiable.

- **O(N^2) judge uniqueness scan:** `judges_paid.es` uses `forall/filter` for uniqueness. Fine for <20 judges; prohibitive above ~256.

---

## Out of Scope

- `reputation-system` npm package (reputation_proof + digital_public_good contracts)
- Off-chain `game-service` / `solver-service`
- Transaction-builder correctness (`src/lib/ergo/actions/*.ts`)
- Blake2b-256 / SigmaProp cryptographic primitives
- Test suite (`tests/*.ts`)

---

*Combined from two independent audits. See [issue #13](https://github.com/game-of-prompts/app/issues/13) for the original filing.*
