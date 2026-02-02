import {
    OutputBuilder,
    TransactionBuilder,
    RECOMMENDED_MIN_FEE_VALUE,
    SAFE_MIN_BOX_VALUE,
    type Box,
    type Amount
} from '@fleet-sdk/core';
import { SColl, SByte } from '@fleet-sdk/serializer';
import { getGopJudgesPaidErgoTreeHex } from '../contract';
import { parseBox, pkHexToBase58Address, hexToBytes } from '$lib/ergo/utils';
import { type GameResolution, type ValidParticipation } from '$lib/common/game';
import { calculatePayouts } from '../utils/payout_calculator';
import { get } from 'svelte/store';
import { explorer_uri } from '../envs';
declare const ergo: any;

async function fetchBox(boxId: string): Promise<Box<Amount> | null> {
    try {
        const res = await fetch(`${get(explorer_uri)}/api/v1/boxes/${boxId}`);
        if (res.ok) return await res.json();
        return null;
    } catch (e) {
        console.error("Error fetching box:", e);
        return null;
    }
}

export async function end_game(
    game: GameResolution,
    participations: ValidParticipation[]
): Promise<string> {

    console.log(`[end_game] Participations: ${participations.length}`)
    console.log(`[end_game] Starting game finalization: ${game.boxId}`);

    if (!game.configBoxId) throw new Error("Game is missing configBoxId");
    const configBox = await fetchBox(game.configBoxId);
    if (!configBox) throw new Error("Could not fetch Config Box");

    const currentHeight = await ergo.get_current_height();
    const userAddress = await ergo.get_change_address();

    const winnerParticipation = participations.find(p => p.commitmentC_Hex === game.winnerCandidateCommitment) ?? null;

    // --- 3. Verificación de firma ---
    let requiredSignerAddress: string;

    if (winnerParticipation === null) {
        requiredSignerAddress = pkHexToBase58Address(game.resolverPK_Hex || undefined);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Invalid signature. Resolver (${requiredSignerAddress}) required.`);
        }
    } else {
        requiredSignerAddress = pkHexToBase58Address(winnerParticipation.playerPK_Hex || undefined);
        if (userAddress !== requiredSignerAddress) {
            throw new Error(`Invalid signature. Winner (${requiredSignerAddress}) required.`);
        }
    }

    // --- 4. Lógica de Cálculo de Pagos (Shared) ---
    const {
        finalWinnerPrize,
        finalResolverPayout,
        finalDevPayout,
        finalJudgesPayout
    } = calculatePayouts(game, participations);

    // --- 5. Construcción de Outputs ---
    const outputs: OutputBuilder[] = [];

    // El NFT del juego siempre se encuentra en el indice 0 de los assets
    const gameNft = game.box.assets[0];

    // Helper para construir cajas (Maneja Token vs ERG)
    const buildOutput = (amount: bigint, script: string, other_tokens: any[] = []) => {
        // Token Game: Min ERG + Tokens
        return new OutputBuilder(SAFE_MIN_BOX_VALUE, script)
            .addTokens([...other_tokens, { tokenId: game.participationTokenId!, amount: amount }]);
    };

    if (winnerParticipation !== null && finalWinnerPrize > 0n) {
        const out = buildOutput(finalWinnerPrize, winnerParticipation.playerScript_Hex, [gameNft]);
        outputs.push(out);
    }

    if (finalResolverPayout > 0n) {
        // Si no hay ganador, el resolver recupera el NFT
        const resolverOutput = buildOutput(finalResolverPayout, game.resolverScript_Hex, winnerParticipation === null ? [gameNft] : []);
        outputs.push(resolverOutput);
    }

    if (finalDevPayout > 0n) {
        outputs.push(buildOutput(finalDevPayout, game.constants.DEV_SCRIPT));
    }

    if (finalJudgesPayout > 0n && (game.judges ?? []).length > 0) {
        const judgesPaidErgoTree = getGopJudgesPaidErgoTreeHex();

        const judgesTokenIdsBytes = game.judges.map(hexToBytes).filter(b => b !== null) as Uint8Array[];
        const tokenBytes = hexToBytes(game.participationTokenId) || new Uint8Array(0);

        const judgesPaidOutput = buildOutput(finalJudgesPayout, judgesPaidErgoTree)
            .setAdditionalRegisters({
                R4: SColl(SColl(SByte), judgesTokenIdsBytes).toHex(),
                R5: SColl(SByte, tokenBytes).toHex()
            });

        outputs.push(judgesPaidOutput);
    }

    // --- 6. Transacción ---
    const utxos = await ergo.get_utxos();
    const inputs = [parseBox(game.box), ...participations.map(p => parseBox(p.box)), ...utxos];
    const dataInputs = [configBox]; // Add Config Box

    const unsignedTransaction = new TransactionBuilder(currentHeight)
        .from(inputs)
        .to(outputs)
        .sendChangeTo(userAddress)
        .payFee(RECOMMENDED_MIN_FEE_VALUE)
        .withDataFrom(dataInputs)
        .build()
        .toEIP12Object();

    try {
        const signedTransaction = await ergo.sign_tx(unsignedTransaction);
        const txId = await ergo.submit_tx(signedTransaction);
        console.log(`Success! Tx ID: ${txId}`);
        return txId;
    }
    catch (error) {
        console.error("Tx Error:", error);
        throw error;
    }
}