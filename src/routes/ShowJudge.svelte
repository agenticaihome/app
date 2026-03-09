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

	let proof: ReputationProof | undefined = undefined;

	const unsubscribeDetail = judge_detail.subscribe((value) => {
		proof = value ?? undefined;
	});

	onDestroy(() => {
		unsubscribeDetail();
	});

	$: displayProof = proof ?? get(reputation_proof);

	// Use the app design tokens directly so Profile always matches outer layout
	// in both light and dark modes without duplicating hardcoded hex palettes.
	const profileTheme = {
		textPrimary: "hsl(var(--foreground))",
		textSecondary: "hsl(var(--foreground) / 0.8)",
		textMuted: "hsl(var(--muted-foreground))",
		bgPage: "hsl(var(--background))",
		bgCard: "hsl(var(--card))",
		bgInput: "hsl(var(--secondary))",
		bgHover: "hsl(var(--muted) / 0.35)",
		borderColor: "hsl(var(--border))",
		borderSubtle: "hsl(var(--border) / 0.6)",
		accentPrimary: "hsl(var(--primary))",
		accentSecondary: "hsl(var(--accent))",
		scoreGlow: "rgba(74, 222, 128, 0.2)",
	};
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

		/* Overrides for hardcoded orange accents inside reputation-system Profile */
		:global(.show-judge-container .profile-container .project-title) {
			background: linear-gradient(
				135deg,
				var(--gop-green-500),
				var(--gop-green-600)
			);
			-webkit-background-clip: text;
			background-clip: text;
			color: transparent;
		}

		:global(.show-judge-container .profile-container .profile-avatar) {
			background: linear-gradient(
				135deg,
				var(--gop-green-400),
				var(--gop-green-600)
			);
			box-shadow: 0 4px 12px rgba(34, 197, 94, 0.25);
		}

		:global(.show-judge-container .profile-container .icon-circle.orange) {
			background-color: rgba(74, 222, 128, 0.1);
			color: #16a34a;
		}

		:global(.show-judge-container .profile-container .asset-card.orange-gradient) {
			background: linear-gradient(
				to bottom right,
				rgba(74, 222, 128, 0.05),
				rgba(22, 163, 74, 0.04)
			);
			border: 1px solid rgba(34, 197, 94, 0.22);
		}

		:global(.show-judge-container .profile-container .badge.orange) {
			background-color: rgba(74, 222, 128, 0.12);
			color: #22c55e;
			border: 1px solid rgba(34, 197, 94, 0.3);
		}

		:global(.show-judge-container .profile-container .item-type),
		:global(.show-judge-container .profile-container .active .item-icon),
		:global(.show-judge-container .profile-container .main-tab-btn.active),
		:global(.show-judge-container .profile-container .main-tab-btn.active .tab-count),
		:global(.show-judge-container .profile-container .sacrifice-toggle-btn),
		:global(.show-judge-container .profile-container .create-profile-btn-v2:hover) {
			background: rgba(74, 222, 128, 0.12);
			border-color: rgba(34, 197, 94, 0.35);
			color: hsl(var(--primary));
		}
	</style>
