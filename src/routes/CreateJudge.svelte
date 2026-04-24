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
    let name = "";
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
            // All the user profiles.
            const profiles = await fetchAllUserProfiles(
                get(explorer_uri),
                null,
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
    $: canSubmitNew = name.trim().length > 0;
    $: submitDisabled =
        isSubmitting ||
        (registrationMode === "existing" ? !canSubmitExisting : !canSubmitNew);
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
                const trimmedName = name.trim();

                if (!trimmedName) {
                    throw new Error("Please enter a profile name");
                }

                const burned_amount = BigInt(
                    Math.floor(burned_amount_erg * 10 ** 9),
                ); // Convert to nanoErgs

                tx = await create_profile(
                    get(explorer_uri),
                    99999999,  // max number of opinions.
                    JUDGE,
                    { name: trimmedName }, // content
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

<div class="create-judge-page min-h-screen bg-background text-foreground">
    <div
        class="create-judge-container w-full md:max-w-[95%] mx-auto px-0 md:px-4 lg:px-8 py-0 md:py-8"
    >
        <section
            class="hero-section relative overflow-hidden mb-6 md:mb-8 rounded-none md:rounded-xl border-y md:border border-border/60 bg-card shadow-[0_10px_28px_rgba(0,0,0,0.12)]"
        >
            <div class="hero-backdrop absolute inset-0"></div>
            <div class="relative z-10 px-4 py-8 md:px-8 md:py-10 text-center">
                <div class="hero-badge">Judge Registration</div>
                <h2 class="project-title">Become a Judge</h2>
                <p class="subtitle">
                    Create a dedicated judge profile or turn one of your existing
                    profiles into a judge identity.
                </p>
            </div>
        </section>

        {#if !transactionId}
            <section
                class="content-panel mb-6 md:mb-8 p-4 md:p-6 rounded-none md:rounded-xl border-y md:border border-border/50 bg-card shadow-lg"
            >
                <div class="panel-header">
                    <h3 class="section-title">What It Means to Be a Judge</h3>
                    <p class="section-copy">
                        Judges help validate outcomes and build public credibility
                        through transparent, on-chain actions.
                    </p>
                </div>

                <div class="benefits-grid">
                    <div class="info-box">
                        <span class="info-eyebrow">Role</span>
                        <p>
                            You can be nominated to decide whether game submissions
                            are valid.
                        </p>
                    </div>
                    <div class="info-box">
                        <span class="info-eyebrow">Open Judging</span>
                        <p>
                            You may also judge games or judges outside formal
                            nominations.
                        </p>
                    </div>
                    <div class="info-box">
                        <span class="info-eyebrow">Transparency</span>
                        <p>
                            Every judgment is recorded on-chain for anyone to
                            inspect.
                        </p>
                    </div>
                    <div class="info-box">
                        <span class="info-eyebrow">Reputation</span>
                        <p>
                            Honest decisions strengthen your profile and make
                            creators more likely to nominate you.
                        </p>
                    </div>
                    <div class="info-box">
                        <span class="info-eyebrow">Commissions</span>
                        <p>
                            You can negotiate compensation with the game creator
                            for your judging work.
                        </p>
                    </div>
                    <div class="info-box">
                        <span class="info-eyebrow">Optional Burn</span>
                        <p>
                            Burning ERG can reinforce your credibility as a public
                            signal of commitment.
                        </p>
                    </div>
                </div>
            </section>

            <section
                class="content-panel mb-6 md:mb-8 p-4 md:p-6 rounded-none md:rounded-xl border-y md:border border-border/50 bg-card shadow-lg"
            >
                <div class="panel-header">
                    <h3 class="section-title">Registration Method</h3>
                    <p class="section-copy">
                        Choose whether to reuse an existing reputation profile or
                        mint a new one dedicated to judging.
                    </p>
                </div>

                <div class="mode-grid">
                    <label
                        class:mode-card={true}
                        class:mode-card-active={registrationMode === "existing"}
                        class:mode-card-disabled={userProfiles.length === 0}
                    >
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

                    <label
                        class:mode-card={true}
                        class:mode-card-active={registrationMode === "new"}
                    >
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
            </section>

            <section
                class="content-panel p-4 md:p-6 rounded-none md:rounded-xl border-y md:border border-border/50 bg-card shadow-lg"
            >
                <div class="panel-header">
                    <h3 class="section-title">Profile Setup</h3>
                    <p class="section-copy">
                        Complete the fields required for the registration mode you
                        selected.
                    </p>
                </div>

                {#if registrationMode === "existing"}
                    <div class="form-group">
                        <label
                            for="existing_profile"
                            class="form-label"
                            >Select one of your profiles</label
                        >
                        <select
                            id="existing_profile"
                            bind:value={selectedProfileTokenId}
                            class="form-control"
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
                            <p class="helper-text">
                                Loading your profiles...
                            </p>
                        {/if}

                        {#if selectedExistingProfile}
                            <div class="selection-hint mt-4">
                                <p>
                                    <span class="info-eyebrow">Selected token</span>
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
                                    <p class="helper-text">
                                        A `JUDGE` opinion will be created with
                                        `object_pointer` set to this profile's
                                        `reputation_token_id`.
                                    </p>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {:else}
                    <div class="form-stack">
                        <div class="form-group">
                            <label
                                for="judge_name"
                                class="form-label"
                                >Profile name</label
                            >
                            <input
                                type="text"
                                id="judge_name"
                                bind:value={name}
                                placeholder="Enter the judge name"
                                class="form-control"
                            />
                            <p class="helper-text">
                                This name will be stored in the new judge profile.
                            </p>
                        </div>

                        <div class="form-group">
                            <label
                                for="burned_amount"
                                class="form-label"
                                >Amount of ERG to Burn (Optional)</label
                            >
                            <input
                                type="number"
                                id="burned_amount"
                                bind:value={burned_amount_erg}
                                min="0"
                                step="0.001"
                                placeholder="Enter ERG amount (e.g., 1.5)"
                                class="form-control"
                            />
                            <p class="helper-text">
                                Burning ERG enhances your reputation profile,
                                signaling honesty. This amount is permanently
                                burned and cannot be recovered.
                            </p>
                        </div>
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
            </section>
        {:else}
            <section
                class="content-panel p-4 md:p-6 rounded-none md:rounded-xl border-y md:border border-border/50 bg-card shadow-lg"
            >
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
            </section>
        {/if}

        {#if errorMessage && !isSubmitting}
            <div
                class="error mt-6 rounded-none md:rounded-xl border-y md:border border-red-500/20 bg-red-500/10 p-4 text-center text-red-500 shadow-sm"
            >
                <p>{errorMessage}</p>
            </div>
        {/if}
    </div>
</div>

<style lang="postcss">
    .create-judge-page {
        padding-top: 2rem;
        padding-bottom: 2rem;
    }
    .create-judge-container {
        max-width: 980px;
        margin: 0 auto;
    }
    .hero-backdrop {
        background:
            radial-gradient(circle at top left, rgba(74, 222, 128, 0.14), transparent 40%),
            linear-gradient(135deg, rgba(15, 23, 42, 0.16), transparent 65%);
    }
    .hero-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.35rem 0.85rem;
        border-radius: 9999px;
        border: 1px solid rgba(34, 197, 94, 0.22);
        background: rgba(34, 197, 94, 0.1);
        color: rgb(34 197 94);
        font-size: 0.7rem;
        font-weight: 900;
        letter-spacing: 0.2em;
        text-transform: uppercase;
    }
    .project-title {
        text-align: center;
        font-size: clamp(2.2rem, 5vw, 3.2rem);
        font-family: "Russo One", sans-serif;
        color: hsl(var(--foreground));
        margin-top: 1.2rem;
    }
    .subtitle {
        font-size: 1.05rem;
        color: hsl(var(--muted-foreground));
        margin: 0.75rem auto 0;
        max-width: 42rem;
    }
    .content-panel {
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
    .panel-header {
        margin-bottom: 1.5rem;
    }
    .section-title {
        @apply text-xl md:text-2xl font-semibold text-slate-800 dark:text-slate-200;
    }
    .section-copy {
        @apply mt-2 text-sm md:text-base text-muted-foreground;
    }
    .benefits-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 1rem;
    }
    .info-box {
        @apply rounded-xl border bg-card text-card-foreground shadow-sm p-4;
    }
    .info-box p {
        @apply mt-2 text-sm leading-6 text-muted-foreground;
    }
    .info-eyebrow {
        @apply inline-flex text-[11px] uppercase tracking-[0.2em] font-black text-muted-foreground;
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
        padding: 1.1rem;
        border-radius: 0.9rem;
        border: 1px solid hsl(var(--border) / 0.7);
        background: hsl(var(--card));
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
        cursor: pointer;
        transition:
            border-color 0.2s ease,
            box-shadow 0.2s ease,
            transform 0.2s ease,
            background-color 0.2s ease;
    }
    .mode-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 10px 24px rgba(2, 6, 23, 0.08);
    }
    .mode-card-active {
        border-color: rgba(34, 197, 94, 0.4);
        box-shadow: 0 0 0 1px rgba(34, 197, 94, 0.14), 0 10px 24px rgba(2, 6, 23, 0.1);
        background: linear-gradient(
            180deg,
            rgba(34, 197, 94, 0.08),
            transparent 60%
        );
    }
    .mode-card-disabled {
        opacity: 0.65;
        cursor: not-allowed;
    }
    .mode-card input {
        margin-top: 0.2rem;
    }
    .mode-card strong {
        @apply text-base text-foreground;
    }
    .mode-card p {
        @apply text-sm text-muted-foreground mt-1;
    }
    .form-stack {
        display: grid;
        gap: 1.25rem;
    }
    .form-group {
        display: flex;
        flex-direction: column;
    }
    .form-label {
        @apply block text-sm font-medium text-muted-foreground mb-2;
    }
    .form-control {
        width: 100%;
        padding: 0.8rem 0.95rem;
        border-radius: 0.9rem;
        border: 1px solid hsl(var(--border) / 0.8);
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
    }
    .form-control:focus {
        outline: none;
        border-color: rgba(34, 197, 94, 0.42);
        box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.14);
    }
    .helper-text {
        @apply mt-2 text-sm text-muted-foreground;
    }
    .selection-hint {
        @apply rounded-xl border p-4 text-sm shadow-sm;
        border-color: hsl(var(--border) / 0.8);
        background: hsl(var(--background));
    }
    .warning-text {
        color: rgb(239 68 68);
        margin-top: 0.6rem;
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
        background: hsl(var(--background));
        border-color: hsl(var(--border) / 0.8);
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.08);
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
    @media (max-width: 768px) {
        .content-panel {
            border-left: 0;
            border-right: 0;
        }
    }
</style>
