<script lang="ts">
    import { onMount } from "svelte";
    import { Button } from "$lib/components/ui/button";
    import {
        create_opinion,
        create_profile,
        fetchAllUserProfiles,
        type RPBox,
        type ReputationProof,
    } from "reputation-system";
    import { JUDGE } from "$lib/ergo/reputation/types";
    import { web_explorer_uri_tx, explorer_uri } from "$lib/ergo/envs";
    import { get } from "svelte/store";
    import { address, connected, reputation_proof } from "$lib/common/store";
    import { fetchTypeNfts } from "$lib/ergo/reputation/fetch";

    let transactionId: string | null = null;
    let isSubmitting: boolean = false;
    let errorMessage: string | null = null;
    let burned_amount_erg: number = 0; // Default to 0 (optional burn)
    let copiedTx: boolean = false;
    let registrationMode: "new" | "existing" = "new";
    let userProfiles: ReputationProof[] = [];
    let selectedProfileTokenId = "";
    let isLoadingProfiles = false;
    let profilesLoadedForWallet = false;
    let loadedAddress: string | null = null;

    function isJudgeProfile(profile: ReputationProof): boolean {
        return profile.current_boxes.some(
            (box) =>
                box.type.tokenId === JUDGE &&
                box.object_pointer === profile.token_id,
        );
    }

    function getMainBox(profile: ReputationProof): RPBox | undefined {
        return profile.current_boxes.find(
            (box) =>
                box.object_pointer === profile.token_id && box.is_locked === false,
        );
    }

    function getProfileLabel(profile: ReputationProof): string {
        const typeNames = profile.types
            .map((type) => type.typeName)
            .filter(Boolean)
            .join(", ");
        const baseLabel = `Profile ${profile.token_id.slice(0, 8)}...${profile.token_id.slice(-6)}`;
        return typeNames ? `${baseLabel} (${typeNames})` : baseLabel;
    }

    async function loadUserProfiles() {
        if (!$connected) {
            userProfiles = [];
            selectedProfileTokenId = "";
            profilesLoadedForWallet = false;
            loadedAddress = null;
            return;
        }

        isLoadingProfiles = true;

        try {
            const types = await fetchTypeNfts();
            const profiles = await fetchAllUserProfiles(
                get(explorer_uri),
                true,
                [],
                types,
            );
            userProfiles = profiles;

            if (profiles.length === 0) {
                registrationMode = "new";
                selectedProfileTokenId = "";
            } else {
                const activeTokenId = get(reputation_proof)?.token_id;
                const preferredProfile =
                    profiles.find((profile) => profile.token_id === activeTokenId) ??
                    profiles[0];
                selectedProfileTokenId = preferredProfile?.token_id ?? "";
                if (registrationMode === "new" && profiles.length > 0) {
                    registrationMode = "existing";
                }
            }

            profilesLoadedForWallet = true;
            loadedAddress = $address;
        } catch (error: any) {
            console.error("Error loading user profiles", error);
            errorMessage =
                error?.message || "Could not load your existing profiles.";
        } finally {
            isLoadingProfiles = false;
        }
    }

    onMount(loadUserProfiles);

    $: if ($connected && $address !== loadedAddress) {
        profilesLoadedForWallet = false;
    }

    $: if ($connected && !profilesLoadedForWallet && !isLoadingProfiles) {
        loadUserProfiles();
    }

    $: if (!$connected) {
        userProfiles = [];
        selectedProfileTokenId = "";
        profilesLoadedForWallet = false;
        loadedAddress = null;
        registrationMode = "new";
    }

    $: selectedExistingProfile =
        userProfiles.find((profile) => profile.token_id === selectedProfileTokenId) ??
        null;
    $: selectedExistingMainBox = selectedExistingProfile
        ? getMainBox(selectedExistingProfile)
        : null;
    $: selectedExistingAlreadyJudge = selectedExistingProfile
        ? isJudgeProfile(selectedExistingProfile)
        : false;
    $: canSubmitExisting =
        !!selectedExistingProfile &&
        !!selectedExistingMainBox &&
        !selectedExistingAlreadyJudge;
    $: submitDisabled =
        isSubmitting ||
        (registrationMode === "existing" ? !canSubmitExisting : false);
    $: submitLabel =
        registrationMode === "existing"
            ? "Mark Profile as Judge"
            : "Create Judge Profile";

    async function submit() {
        isSubmitting = true;
        errorMessage = null;
        transactionId = null;
        copiedTx = false;

        try {
            if (burned_amount_erg < 0) {
                throw new Error("Burned amount cannot be negative");
            }
            let tx: string | null = null;

            if (registrationMode === "existing") {
                if (!selectedExistingProfile) {
                    throw new Error("Please select a profile");
                }
                if (selectedExistingAlreadyJudge) {
                    throw new Error("This profile is already marked as judge");
                }
                if (!selectedExistingMainBox) {
                    throw new Error("No unlocked main box found for this profile");
                }

                tx = await create_opinion(
                    get(explorer_uri),
                    1,
                    JUDGE,
                    selectedExistingProfile.token_id,
                    true,
                    null,
                    false,
                    selectedExistingMainBox,
                );
            } else {
                const burned_amount = BigInt(
                    Math.floor(burned_amount_erg * 10 ** 9),
                ); // Convert to nanoErgs

                tx = await create_profile(
                    get(explorer_uri),
                    1, // total_supply for a judge profile (usually 1 for a unique profile)
                    JUDGE,
                    null, // content
                    burned_amount,
                    [], // sacrified_tokens
                );
            }

            transactionId = tx;
        } catch (error: any) {
            console.error(error);
            errorMessage = error.message.includes("insufficient funds")
                ? "Insufficient ERG in your wallet"
                : error.message ||
                  "Error occurred while registering as a judge";
        } finally {
            isSubmitting = false;
        }
    }

    async function copyTransactionId() {
        if (!transactionId) return;

        try {
            await navigator.clipboard.writeText(transactionId);
            copiedTx = true;
            setTimeout(() => {
                copiedTx = false;
            }, 2000);
        } catch (error) {
            console.error("Unable to copy transaction id", error);
        }
    }
</script>

<div class="create-judge-container">
    <div class="hero-section text-center">
        <h2 class="project-title">Become a Judge</h2>
        <p class="subtitle">
            Discover the role of a judge and join the action.
        </p>
    </div>

    <div class="content-section">
        {#if !transactionId}
            <h3 class="section-title">What It Means to Be a Judge</h3>
            <ul class="judge-description list-disc pl-6 space-y-3">
                <li>
                    <strong>Nominated Role:</strong> You can be chosen to decide
                    which game submissions are valid, if you accept the game.
                </li>
                <li>
                    <strong>Open Judging:</strong> Judge any game or judge, even
                    if you're not nominated (no impact on game outcome).
                </li>
                <li>
                    <strong>On-Chain Transparency:</strong> All your judgments are
                    recorded on the blockchain for anyone to verify your honesty.
                </li>
                <li>
                    <strong>Build Your Reputation:</strong> A strong, honest track
                    record makes game creators want to nominate you as a judge.
                </li>
                <li>
                    <strong>Negotiate Commissions:</strong> As a judge, you can negotiate
                    with the game creator to receive a portion of their commission
                    for your judging role.
                </li>
                <li>
                    <strong>Burn ERG for Credibility:</strong> Optionally burn ERG
                    to strengthen your reputation profile. This permanent sacrifice
                    signals your commitment to honesty, making you stand out to game
                    creators.
                </li>
            </ul>

            <div class="form-group mt-6">
                <span class="block text-sm font-medium text-muted-foreground"
                    >How do you want to register?</span
                >
                <div class="mode-grid mt-3">
                    <label class="mode-card">
                        <input
                            type="radio"
                            bind:group={registrationMode}
                            value="existing"
                            disabled={userProfiles.length === 0}
                        />
                        <div>
                            <strong>Use an existing profile</strong>
                            <p>
                                Add a self-definition box of type `JUDGE`
                                pointing to that profile's reputation token.
                            </p>
                        </div>
                    </label>

                    <label class="mode-card">
                        <input
                            type="radio"
                            bind:group={registrationMode}
                            value="new"
                        />
                        <div>
                            <strong>Create a new judge profile</strong>
                            <p>
                                Mint a brand new reputation profile specifically
                                for judging.
                            </p>
                        </div>
                    </label>
                </div>
            </div>

            {#if registrationMode === "existing"}
                <div class="form-group mt-4">
                    <label
                        for="existing_profile"
                        class="block text-sm font-medium text-muted-foreground"
                        >Select one of your profiles</label
                    >
                    <select
                        id="existing_profile"
                        bind:value={selectedProfileTokenId}
                        class="mt-1 w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-background text-foreground"
                        disabled={isLoadingProfiles || userProfiles.length === 0}
                    >
                        {#if userProfiles.length === 0}
                            <option value="">
                                No existing profiles found
                            </option>
                        {:else}
                            {#each userProfiles as profile}
                                <option value={profile.token_id}>
                                    {getProfileLabel(profile)}
                                </option>
                            {/each}
                        {/if}
                    </select>

                    {#if isLoadingProfiles}
                        <p class="text-sm text-muted-foreground mt-1">
                            Loading your profiles...
                        </p>
                    {/if}

                    {#if selectedExistingProfile}
                        <div class="selection-hint mt-3">
                            <p>
                                Selected token:
                                <code>{selectedExistingProfile.token_id}</code>
                            </p>
                            {#if selectedExistingAlreadyJudge}
                                <p class="warning-text">
                                    This profile already defines itself as a
                                    judge.
                                </p>
                            {:else if !selectedExistingMainBox}
                                <p class="warning-text">
                                    This profile does not have an unlocked main
                                    box available right now.
                                </p>
                            {:else}
                                <p class="text-sm text-muted-foreground">
                                    A `JUDGE` opinion will be created with
                                    `object_pointer` set to this profile's
                                    `reputation_token_id`.
                                </p>
                            {/if}
                        </div>
                    {/if}
                </div>
            {:else}
                <div class="form-group mt-4">
                    <label
                        for="burned_amount"
                        class="block text-sm font-medium text-muted-foreground"
                        >Amount of ERG to Burn (Optional)</label
                    >
                    <input
                        type="number"
                        id="burned_amount"
                        bind:value={burned_amount_erg}
                        min="0"
                        step="0.001"
                        placeholder="Enter ERG amount (e.g., 1.5)"
                        class="mt-1 w-full p-2 rounded border border-gray-300 dark:border-gray-600 bg-background text-foreground"
                    />
                    <p class="text-sm text-muted-foreground mt-1">
                        Burning ERG enhances your reputation profile, signaling
                        honesty. This amount is permanently burned and cannot be
                        recovered.
                    </p>
                </div>
            {/if}

            <div class="form-actions mt-8 flex justify-center">
                <Button
                    size="lg"
                    class="w-full sm:w-auto text-base"
                    on:click={submit}
                    disabled={submitDisabled}
                >
                    {#if isSubmitting}
                        <span class="spinner mr-2"></span> Registering...
                    {:else}
                        {submitLabel}
                    {/if}
                </Button>
            </div>
        {:else}
            <div class="result-container">
                <div class="status-pill">Pending on-chain confirmation</div>
                <h3 class="result-title">Registration Submitted</h3>
                <p class="result-description">
                    {#if registrationMode === "existing"}
                        Your judge self-definition transaction has been sent to
                        the blockchain.
                    {:else}
                        Your judge profile transaction has been sent to the
                        blockchain.
                    {/if}
                    Confirmation can take a few moments.
                </p>

                <div class="tx-card" aria-live="polite">
                    <span class="tx-label">Transaction ID</span>
                    <a
                        href={get(web_explorer_uri_tx) + transactionId}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="tx-value"
                        title="Open transaction in explorer"
                    >
                        {transactionId}
                    </a>
                </div>

                <div class="tx-actions">
                    <a
                        href={get(web_explorer_uri_tx) + transactionId}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="action-button"
                    >
                        View on Explorer
                    </a>
                    <button
                        on:click={copyTransactionId}
                        class={`action-button action-button-secondary ${copiedTx ? "is-copied" : ""}`}
                    >
                        {copiedTx ? "Copied" : "Copy TxID"}
                    </button>
                </div>
            </div>
        {/if}

        {#if errorMessage && !isSubmitting}
            <div
                class="error mt-6 bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-center text-red-500"
            >
                <p>{errorMessage}</p>
            </div>
        {/if}
    </div>
</div>

<style lang="postcss">
    .create-judge-container {
        max-width: 700px;
        margin: 0 auto;
        padding: 10px 15px 4rem;
    }
    .project-title {
        text-align: center;
        font-size: 2.8rem;
        font-family: "Russo One", sans-serif;
        color: hsl(var(--primary));
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }
    .subtitle {
        font-size: 1.1rem;
        color: hsl(var(--muted-foreground));
        margin-top: 0.5rem;
        margin-bottom: 3rem;
    }
    .content-section {
        @apply p-6 bg-background/50 backdrop-blur-lg rounded-xl shadow border border-white/10;
        animation: fadeIn 0.5s ease-out;
    }
    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }
    .section-title {
        @apply text-xl font-semibold mb-4 text-slate-800 dark:text-slate-200;
    }
    .judge-description {
        @apply text-base text-muted-foreground leading-relaxed;
    }
    .judge-description li {
        @apply text-base;
    }
    .mode-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
    }
    .mode-card {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
        padding: 1rem;
        border-radius: 0.85rem;
        border: 1px solid color-mix(in oklab, hsl(var(--foreground)) 12%, transparent);
        background: color-mix(in oklab, hsl(var(--background)) 92%, #0f172a 8%);
        cursor: pointer;
    }
    .mode-card input {
        margin-top: 0.2rem;
    }
    .mode-card p {
        @apply text-sm text-muted-foreground mt-1;
    }
    .selection-hint {
        @apply rounded-lg border p-3 text-sm;
        border-color: color-mix(in oklab, hsl(var(--foreground)) 12%, transparent);
        background: color-mix(in oklab, hsl(var(--background)) 90%, #0f172a 10%);
    }
    .warning-text {
        color: rgb(239 68 68);
        margin-top: 0.35rem;
    }
    .result-container {
        @apply py-8 px-4 text-center;
    }
    .status-pill {
        @apply inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide;
        color: hsl(var(--primary));
        background: color-mix(in oklab, hsl(var(--primary)) 18%, transparent);
        border: 1px solid color-mix(in oklab, hsl(var(--primary)) 40%, transparent);
    }
    .result-title {
        @apply mt-4 text-3xl font-bold;
        color: color-mix(in oklab, hsl(var(--primary)) 85%, white 15%);
    }
    .result-description {
        @apply mt-3 text-base leading-relaxed text-muted-foreground max-w-xl mx-auto;
    }
    .tx-card {
        @apply mt-7 rounded-xl border p-4 text-left;
        background: linear-gradient(
            165deg,
            color-mix(in oklab, hsl(var(--background)) 85%, #2b2f3a 15%) 0%,
            color-mix(in oklab, hsl(var(--background)) 80%, #1f2430 20%) 100%
        );
        border-color: color-mix(in oklab, hsl(var(--foreground)) 16%, transparent);
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06);
    }
    .tx-label {
        @apply block text-xs font-semibold uppercase tracking-wider text-muted-foreground;
    }
    .tx-value {
        @apply mt-2 block font-mono text-xs leading-relaxed break-all transition-opacity;
        color: hsl(var(--foreground));
        opacity: 0.9;
    }
    .tx-value:hover {
        opacity: 1;
        text-decoration: underline;
    }
    .tx-actions {
        @apply mt-4 flex flex-col sm:flex-row gap-2 justify-center;
    }
    .action-button {
        @apply inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors;
        background: color-mix(in oklab, hsl(var(--primary)) 90%, black 10%);
        color: hsl(var(--primary-foreground));
        border: 1px solid color-mix(in oklab, hsl(var(--primary)) 75%, black 25%);
    }
    .action-button:hover {
        background: color-mix(in oklab, hsl(var(--primary)) 80%, black 20%);
    }
    .action-button-secondary {
        background: transparent;
        color: hsl(var(--foreground));
        border: 1px solid color-mix(in oklab, hsl(var(--foreground)) 18%, transparent);
    }
    .action-button-secondary:hover {
        background: color-mix(in oklab, hsl(var(--foreground)) 9%, transparent);
    }
    .action-button-secondary.is-copied {
        color: hsl(var(--primary));
        border-color: color-mix(in oklab, hsl(var(--primary)) 50%, transparent);
        background: color-mix(in oklab, hsl(var(--primary)) 10%, transparent);
    }
    .spinner {
        display: inline-block;
        width: 1rem;
        height: 1rem;
        border: 2px solid currentColor;
        border-radius: 50%;
        border-top-color: transparent;
        animation: spin 1s linear infinite;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
