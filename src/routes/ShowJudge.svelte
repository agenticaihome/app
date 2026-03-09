<script lang="ts">
	import {
		reputation_proof,
		judge_detail,
		connected,
	} from "$lib/common/store";
	import { get } from "svelte/store";
	import { type ReputationProof, Profile } from "reputation-system";
	import { onDestroy } from "svelte";
	import { explorer_uri } from "$lib/ergo/envs";
	import { GAME, JUDGE, PARTICIPATION } from "$lib/ergo/reputation/types";
	import { mode } from "mode-watcher";

	let proof: ReputationProof | undefined = undefined;

	const unsubscribeDetail = judge_detail.subscribe((value) => {
		proof = value ?? undefined;
	});

	onDestroy(() => {
		unsubscribeDetail();
	});

	$: displayProof = proof ?? get(reputation_proof);

	// Palette: Zinc (Neutrals) + Green (Brand)

	const lightTheme = {
		textPrimary: "#151617", // GoP near-black
		textSecondary: "#52525b", // Zinc 600 - Readable secondary
		textMuted: "#a1a1aa", // Zinc 400 - Subtle labels
		bgPage: "#fdfbf8", // GoP cream background (matches --background)
		bgCard: "#fdfaf7", // GoP card surface (matches --card)
		bgInput: "#f2ded0", // GoP secondary/input (matches --secondary)
		bgHover: "rgba(0,0,0,0.03)", // Very subtle hover
		borderColor: "#151617", // GoP border (matches --border)
		borderSubtle: "rgba(0,0,0,0.06)", // Light dividers
		accentPrimary: "#16a34a", // Green 600 - Brand green for light bg
		accentSecondary: "#15803d", // Green 700 - Interaction state
		scoreGlow: "rgba(22, 163, 74, 0.15)", // Green glow
	};

	const darkTheme = {
		textPrimary: "#fdfbf8", // GoP cream (matches dark --foreground)
		textSecondary: "#a1a1aa", // Zinc 400 - Soft secondary
		textMuted: "#52525b", // Zinc 600 - De-emphasized
		bgPage: "#151617", // GoP dark background (matches dark --background)
		bgCard: "#252628", // GoP dark card (matches dark --card)
		bgInput: "#1e2022", // GoP dark secondary (matches dark --secondary)
		bgHover: "rgba(255,255,255,0.03)", // Delicate overlay
		borderColor: "#fdfbf8", // GoP dark border (matches dark --border)
		borderSubtle: "rgba(255,255,255,0.05)", // Ghostly dividers
		accentPrimary: "#4ade80", // Green 400 - Brand green pop on dark
		accentSecondary: "#22c55e", // Green 500 - Interaction state
		scoreGlow: "rgba(74, 222, 128, 0.15)", // Green glow
	};

	// Always use dark theme for Profile (preferred by design)
	$: profileTheme = darkTheme;
</script>

<div class="show-judge-container">
	{#if displayProof}
		<Profile
			reputationProof={displayProof}
			userProfiles={[]}
			connected={$connected}
			theme={profileTheme}
			title={proof ? "Judge Details" : "My Reputation"}
			subtitle={proof
				? "Details of the selected judge."
				: "Manage your reputation."}
			explorer_uri={$explorer_uri}
			profile_type_nft_id={JUDGE}
			visibleTokenTypes={[JUDGE, GAME, PARTICIPATION]}
			allowCreateProfile={false}
			allowSacrifice={true}
			showBoxesSection={true}
			showReceivedOpinions={true}
			showProfileSwitcher={false}
			showDidacticInfo={true}
			showFilters={true}
			showTechnicalDetails={true}
			allowSetMainBox={false}
			allowDeleteBox={false}
			allowEditBox={false}
		/>
	{:else}
		<div class="no-proof text-center py-12">
			<h3 class="text-2xl font-bold text-red-500 mb-4">
				No Reputation Proof Found
			</h3>
			<p class="mb-4">
				It looks like you haven't registered a reputation proof yet.
			</p>
			<!-- The Profile component might handle creation if we pass allowCreateProfile, 
                 but if we don't have a proof to pass, we might need to handle it or pass null? 
                 The Profile component props say reputationProof is the object. 
                 If it's null, does it show creation UI? 
                 The docs say "create_profile" function exists. 
                 Let's assume we show a message or maybe the Profile component has a "create" mode if proof is missing?
                 The user's original code had a "Register as a Judge" button.
                 I'll keep the "No proof" message for now as a fallback if Profile doesn't handle null proof.
            -->
			<!-- Actually, let's try to render Profile even if displayProof is null, 
                 maybe it has a creation flow? 
                 But the prop type is `ReputationProof`, not `ReputationProof | null`.
                 So I should probably keep the fallback or check if there's a CreateProfile component.
                 The user's original code had a link to `/create-judge`.
            -->
			<!-- Wait, the original code had:
                 <Button size="lg" href="/create-judge">Register as a Judge</Button>
            -->
			<!-- I will keep the fallback for now. -->
			<a
				href="#"
				on:click|preventDefault={() =>
					(window.location.href = "/create-judge")}
				class="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8"
			>
				Register as a Judge
			</a>
		</div>
	{/if}
</div>

<style lang="postcss">
	.show-judge-container {
		max-width: 1400px;
		margin: 0 auto;
		padding: 2rem 15px 4rem;
	}
</style>
