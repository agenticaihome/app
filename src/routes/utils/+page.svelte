<script lang="ts">
    import { stringifyForChecksum, sha256 } from "$lib/common/utils";
    import { findMatchingScoreForCommitment } from "$lib/common/commitment";
    import { getArrayFromValue } from "$lib/ergo/utils";

    import { Button } from "$lib/components/ui/button";
    import { Input } from "$lib/components/ui/input";
    import { Textarea } from "$lib/components/ui/textarea";
    import { Card, CardHeader, CardContent, CardFooter, CardTitle } from "$lib/components/ui/card";
    import { Label } from "$lib/components/ui/label";

    let fileInput: HTMLInputElement | null = null;
    let jsonUploadError: string | null = null;
    let checksumStatus: 'valid' | 'invalid' | 'missing' | null = null;
    let lastFileName: string | null = null;

    // Form fields (editable)
    let commitment: string = "";
    let solver_id: string = "";
    let hash_logs_hex: string = "";
    let seed: string = "";
    let ergoTree: string = "";
    let score_list: string = ""; // JSON or comma list

    // Secret (required, hex)
    let secret: string = "";

    // Validation result
    let validation: import("$lib/common/commitment").CommitmentValidationResult | null = null;
    let copying = false;

    async function handleFileUpload(e: Event) {
        const target = e.target as HTMLInputElement;
        jsonUploadError = null;
        checksumStatus = null;
        if (!target.files || !target.files[0]) return;
        const file = target.files[0];
        if (file.type !== "application/json" && !file.name.endsWith('.json')) {
            jsonUploadError = "Please upload a JSON file.";
            target.value = "";
            return;
        }

        try {
            const text = await file.text();
            const jsonData = JSON.parse(text);

            // Checksum verification (if present)
            if ("checksum" in jsonData && typeof jsonData.checksum === "string") {
                const expected = jsonData.checksum as string;
                const { checksum: _, ...rest } = jsonData;
                const canonical = stringifyForChecksum(rest as Record<string, unknown>);
                const computed = await sha256(canonical);
                if (computed !== expected) {
                    checksumStatus = 'invalid';
                    jsonUploadError = "Checksum verification failed. The file may be tampered. Fill fields manually.";
                    // clear fields to avoid accidental use
                    commitment = "";
                    solver_id = "";
                    hash_logs_hex = "";
                    seed = "";
                    ergoTree = "";
                    score_list = "";
                    target.value = "";
                    return;
                }
                checksumStatus = 'valid';
            } else {
                checksumStatus = 'missing';
            }

            // Autofill supported names (if present)
            solver_id = jsonData.solver_id || jsonData.solverId || jsonData.solver || solver_id;
            hash_logs_hex = jsonData.hash_logs_hex || jsonData.hashLogsHex || jsonData.hash_logs || hash_logs_hex;
            commitment = jsonData.commitment_c_hex || jsonData.commitment || commitment;
            seed = jsonData.seed_hex || jsonData.seed || seed;
            ergoTree = jsonData.pbox_ergotree || jsonData.ergoTree_hex || jsonData.ergoTree || ergoTree;
            if (jsonData.score_list) {
                try {
                    score_list = JSON.stringify(jsonData.score_list);
                } catch {
                    score_list = String(jsonData.score_list);
                }
            }

            // allow manual correction after autofill
            lastFileName = file.name;
            target.value = "";
        } catch (err) {
            jsonUploadError = "Invalid JSON file.";
            target.value = "";
        }
    }

    async function copyToClipboard(text: string | null) {
        if (!text) return;
        try {
            copying = true;
            await navigator.clipboard.writeText(text);
        } catch (e) {
            // ignore
        } finally {
            setTimeout(() => (copying = false), 600);
        }
    }

    function parseScoreListToBigInt(): bigint[] | null {
        const arr = getArrayFromValue(score_list) ?? null;
        if (!arr) return null;
        try {
            return arr.map((v: any) => BigInt(v));
        } catch {
            return null;
        }
    }

    function clearValidation() {
        validation = null;
    }

    function incompleteResult(reason = 'incomplete') {
        return {
            isValid: false,
            matchedScore: null,
            expectedCommitmentHex: commitment || null,
            computedCommitmentHex: null,
            reason,
        } as import("$lib/common/commitment").CommitmentValidationResult;
    }

    function validate() {
        clearValidation();
        if (!secret) {
            validation = incompleteResult('missing_secret');
            return;
        }

        const scores = parseScoreListToBigInt();
        if (!scores) {
            validation = incompleteResult('invalid_score_list');
            return;
        }

        validation = findMatchingScoreForCommitment({
            declaredCommitmentHex: commitment || null,
            solverIdHex: solver_id || null,
            seedHex: seed || null,
            scoreList: scores,
            hashLogsHex: hash_logs_hex || null,
            ergoTreeHex: ergoTree || null,
            secretHex: secret || null,
        });
    }
</script>

<div class="p-6 max-w-5xl mx-auto">
    <Card>
        <CardHeader class="p-4">
            <div class="flex items-center justify-between">
                <div>
                    <CardTitle>Participation Commitment Utility</CardTitle>
                    <div class="text-sm text-muted-foreground mt-1">Hidden tool — access via /utils</div>
                </div>
                <div class="text-sm text-muted-foreground">Quick verifier for participations</div>
            </div>
        </CardHeader>

        <CardContent class="p-4">
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div class="md:col-span-1 space-y-4">
                    <div>
                        <Label>Upload participation JSON</Label>
                        <div class="flex gap-2 mt-2">
                            <input bind:this={fileInput} type="file" accept="application/json" on:change={handleFileUpload} class="block w-full" />
                        </div>
                        <div class="text-sm text-muted-foreground mt-2">
                            {#if lastFileName}
                                File: {lastFileName}
                            {:else}
                                No file loaded
                            {/if}
                        </div>
                        {#if jsonUploadError}
                            <div class="text-sm text-destructive mt-2">{jsonUploadError}</div>
                        {/if}
                        <div class="flex items-center gap-3 mt-3">
                            <div class="text-sm">Checksum:</div>
                            {#if checksumStatus === 'valid'}
                                <div class="px-2 py-1 rounded bg-green-100 text-green-800 text-sm">valid</div>
                            {:else if checksumStatus === 'invalid'}
                                <div class="px-2 py-1 rounded bg-red-100 text-red-800 text-sm">invalid</div>
                            {:else if checksumStatus === 'missing'}
                                <div class="px-2 py-1 rounded bg-amber-100 text-amber-800 text-sm">missing</div>
                            {:else}
                                <div class="px-2 py-1 rounded bg-slate-100 text-slate-800 text-sm">—</div>
                            {/if}
                        </div>
                    </div>

                    <div>
                        <Label>Secret (hex) — required</Label>
                        <Input bind:value={secret} placeholder="deadbeef..." class="font-mono mt-2" />
                        <div class="text-xs text-muted-foreground mt-1">Secret must be provided in hex to compute commitments.</div>
                    </div>
                </div>

                <div class="md:col-span-2 space-y-4">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <Label>Commitment (commitment_c_hex)</Label>
                            <div class="flex gap-2 mt-2">
                                <Input bind:value={commitment} placeholder="Commitment hex" class="font-mono" />
                                <Button variant="ghost" size="icon" on:click={() => copyToClipboard(commitment)} aria-label="Copy commitment">Copy</Button>
                            </div>
                        </div>

                        <div>
                            <Label>Solver ID (solver_id)</Label>
                            <div class="flex gap-2 mt-2">
                                <Input bind:value={solver_id} placeholder="Solver id hex" class="font-mono" />
                                <Button variant="ghost" size="icon" on:click={() => copyToClipboard(solver_id)} aria-label="Copy solver id">Copy</Button>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <Label>Hash logs (hash_logs_hex)</Label>
                            <div class="flex gap-2 mt-2">
                                <Input bind:value={hash_logs_hex} placeholder="Hash logs hex" class="font-mono" />
                                <Button variant="ghost" size="icon" on:click={() => copyToClipboard(hash_logs_hex)} aria-label="Copy hash logs">Copy</Button>
                            </div>
                        </div>

                        <div>
                            <Label>Seed (seed_hex)</Label>
                            <div class="flex gap-2 mt-2">
                                <Input bind:value={seed} placeholder="Seed hex" class="font-mono" />
                                <Button variant="ghost" size="icon" on:click={() => copyToClipboard(seed)} aria-label="Copy seed">Copy</Button>
                            </div>
                        </div>
                    </div>

                    <div>
                        <Label>Ergo tree (pbox_ergotree / ergoTree_hex)</Label>
                        <div class="flex gap-2 mt-2">
                            <Input bind:value={ergoTree} placeholder="ErgoTree hex" class="font-mono" />
                            <Button variant="ghost" size="icon" on:click={() => copyToClipboard(ergoTree)} aria-label="Copy ergo tree">Copy</Button>
                        </div>
                    </div>

                    <div>
                        <Label>Score list (JSON array or CSV)</Label>
                        <Textarea bind:value={score_list} placeholder='e.g. [1,2,3] or 1,2,3' class="font-mono mt-2" />
                        <div class="text-xs text-muted-foreground mt-1">You can edit scores after uploading JSON. Example: [1,2,3] or 1,2,3</div>
                    </div>
                </div>
            </div>
        </CardContent>

        <CardFooter class="p-4 flex flex-col gap-3">
            <div class="flex gap-2">
                <Button on:click={validate}>Validate</Button>
                <Button variant="outline" on:click={() => { commitment=''; solver_id=''; hash_logs_hex=''; seed=''; ergoTree=''; score_list=''; secret=''; validation=null; lastFileName=null; checksumStatus=null; jsonUploadError=null; }}>Clear</Button>
                <div class="ml-auto text-sm text-muted-foreground">{copying ? 'Copied' : ''}</div>
            </div>

            {#if validation}
                <div class="rounded-md p-3 border">
                    {#if validation.isValid}
                        <div class="flex items-center gap-3">
                            <div class="px-2 py-1 rounded bg-green-100 text-green-800 font-semibold">VALID</div>
                            <div class="font-mono">Matched score: {String(validation.matchedScore)}</div>
                        </div>
                        <div class="mt-2 text-xs">
                            <div>Expected: <span class="font-mono">{validation.expectedCommitmentHex}</span></div>
                            <div>Computed: <span class="font-mono">{validation.computedCommitmentHex}</span></div>
                        </div>
                    {:else}
                        <div class="flex items-center gap-3">
                            <div class="px-2 py-1 rounded bg-red-100 text-red-800 font-semibold">INVALID</div>
                            <div class="text-sm">{validation.reason}</div>
                        </div>
                        <div class="mt-2 text-xs">Expected: <span class="font-mono">{validation.expectedCommitmentHex}</span></div>
                    {/if}
                </div>
            {/if}
        </CardFooter>
    </Card>
</div>
