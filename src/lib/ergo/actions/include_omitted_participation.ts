import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    type Box
} from '@fleet-sdk/core';
import { SColl, SByte, SPair, SLong, SInt } from '@fleet-sdk/serializer';
import { hexToBytes, parseBox, pkHexToBase58Address } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { getGopGameResolutionErgoTreeHex } from '../contract';
import { prependHexPrefix } from '$lib/utils';
import { stringToBytes } from '@scure/base';
import { ErgoPlatform } from '../platform';


declare const ergo: any;

/**
 * Allows any user to include a participation that was omitted
 * during the initial transition to the Resolution phase.
 *
 * @param game The current GameResolution object.
 * @param omittedParticipation The participation in "Submitted" state to include.
 * @param currentWinnerParticipation The already resolved participation of the current winner.
 * @param newResolverPkHex The hexadecimal public key of the user performing the action, who will become the new resolver.
 * @returns A promise that resolves with the transaction ID if successful.
 */
export async function include_omitted_participation(
    game: GameResolution,
    omittedParticipation: ValidParticipation,
    currentWinnerParticipation: ValidParticipation | null,
    newResolverPkHex: string
): Promise<string | null> {

    console.log(`Attempting to include omitted participation ${omittedParticipation.boxId} in game: ${game.boxId}`);

    // --- 1. Preliminary checks ---
    const currentHeight = await (new ErgoPlatform()).get_current_height();
    if (currentHeight >= game.resolutionDeadline) {
        throw new Error("Participations cannot be included after the judges' period ends.");
    }

    const resolverErgoTree = (((game.resolutionDeadline - game.constants.JUDGE_PERIOD) + game.constants.RESOLVER_OMISSION_NO_PENALTY_PERIOD) < currentHeight) ? prependHexPrefix(hexToBytes(newResolverPkHex)!) : hexToBytes(game.resolverScript_Hex)!;

    // --- 3. Build Transaction Outputs ---

    const resolutionErgoTree = getGopGameResolutionErgoTreeHex();;

    const recreatedGameBox = new OutputBuilder(
        BigInt(game.box.value),
        resolutionErgoTree
    )
        .addTokens(game.box.assets)
        .setAdditionalRegisters({
            R4: SInt(1).toHex(), // Preserve state (1: Resolved)

            R5: SColl(SByte, hexToBytes(game.seed)!).toHex(),

            // --- R6: (revealedSecretS, winnerCandidateCommitment) ---
            R6: SPair(
                SColl(SByte, hexToBytes(game.revealedS_Hex)!),
                SColl(SByte, hexToBytes(omittedParticipation.commitmentC_Hex)!)
            ).toHex(),

            // --- R7: participatingJudges: Coll[Coll[Byte]] ---
            R7: SColl(SColl(SByte), game.judges.map((j) => hexToBytes(j)!)).toHex(),

            // --- R8: numericalParameters: [createdAt, timeWeight, deadline, resolverStake, participationFee, perJudgeCommission, resolverCommission, resolutionDeadline] ---
            R8: SColl(SLong, [
                BigInt(game.createdAt),
                BigInt(game.timeWeight),
                BigInt(game.deadlineBlock),
                BigInt(game.resolverStakeAmount),
                BigInt(game.participationFeeAmount),
                BigInt(game.perJudgeCommission),
                BigInt(game.resolverCommission),
                BigInt(game.devCommission),
                BigInt(game.resolutionDeadline)
            ]).toHex(),

            // --- R9: gameProvenance: Coll[Coll[Byte]] (Game details in JSON/Hex, Participation token id, devScript, Resolver spend script) ---
            R9: SColl(SColl(SByte), [stringToBytes('utf8', game.content.rawJsonString), hexToBytes(game.participationTokenId) ?? "", hexToBytes(game.devScript)!, resolverErgoTree]).toHex()
        });

    const pBox = parseBox(omittedParticipation.box);

    // --- 4. Build and Send the Transaction ---
    const userAddress = pkHexToBase58Address(newResolverPkHex);
    const utxos: Box<any>[] = await ergo.get_utxos();
    if (!omittedParticipation.solverIdBox) {
        throw new Error("Omitted participation does not have a solver ID box.");
    }
    const solverIdBox = omittedParticipation.solverIdBox;

    const dataInputs = currentWinnerParticipation ? [parseBox(currentWinnerParticipation.box), pBox, solverIdBox] : [pBox, solverIdBox];

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(parseBox(game.box), { ensureInclusion: true })
        .and.from(utxos)
        .to([recreatedGameBox])
        .withDataFrom(dataInputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .build();

    const signedTransaction = await ergo.sign_tx(unsignedTransaction.toEIP12Object());
    const txId = await ergo.submit_tx(signedTransaction);

    console.log(`Transaction to include omitted participation sent. ID: ${txId}`);
    return txId;
}
