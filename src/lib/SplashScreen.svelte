<script lang="ts">
	import { mode } from "mode-watcher";
	import { onMount } from "svelte";
	import { base } from "$app/paths";

	export let urlTheme: string | null = null;

	let el: HTMLDivElement | undefined;

	$: themeFromUrl = urlTheme === "light" || urlTheme === "dark" ? urlTheme : null;
	$: currentTheme = themeFromUrl ?? ($mode === "light" ? "light" : "dark");
	$: isLight = currentTheme === "light";

	onMount(() => {
		const dismiss = () => {
			const target = el ?? document.getElementById("gop-splash");
			if (!target) return;
			target.style.transition = "opacity 0.75s ease";
			target.style.opacity = "0";
			target.style.pointerEvents = "none";
			window.setTimeout(() => {
				target.style.display = "none";
			}, 800);
		};

		const t1 = window.setTimeout(dismiss, 5000);
		return () => window.clearTimeout(t1);
	});
</script>

<div
	bind:this={el}
	id="gop-splash"
	class="splash"
	class:is-light={isLight}
	class:is-dark={!isLight}
	aria-hidden="true"
>
	<div class="scanline"></div>
	<div class="content">
		<div class="logo-wrap">
			<div class="scanline-overlay"></div>
			<div class="glitch-wrapper">
				<img src={`${base}/complete-logo.png`} alt="Game of Prompts" class="logo-img" />
				<img src={`${base}/complete-logo.png`} alt="" class="logo-img glitch-r" aria-hidden="true" />
				<img src={`${base}/complete-logo.png`} alt="" class="logo-img glitch-b" aria-hidden="true" />
			</div>
			<div class="logo-glow"></div>
		</div>
		<div class="title-wrap">
			<h1 class="title" data-text="GAME OF PROMPTS">GAME OF PROMPTS</h1>
		</div>
		<p class="subtitle">WRITE YOUR PROMPTS. BUILD YOUR BOT. WIN THE THRONE.</p>
		<div class="progress-bar">
			<div class="progress-fill"></div>
		</div>
	</div>
	<div class="corner-tl"></div>
	<div class="corner-tr"></div>
	<div class="corner-bl"></div>
	<div class="corner-br"></div>
</div>

<style>
	.splash {
		position: fixed;
		inset: 0;
		background: #000;
		color-scheme: dark;
		z-index: 99998;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		opacity: 1;
		transition: opacity 0.75s ease;
	}

	.splash.is-light {
		background: radial-gradient(circle at 50% 40%, #f8fff9 0%, #f1f8f2 55%, #e7f3ea 100%);
		color-scheme: light;
	}

	.splash.is-light .scanline {
		opacity: 0.35;
	}

	.splash.is-light .title {
		color: #15803d;
		text-shadow:
			0 0 14px rgb(34 197 94 / 35%),
			0 0 28px rgb(34 197 94 / 20%);
	}

	.splash.is-light .subtitle {
		color: rgb(21 128 61 / 82%);
	}

	.splash.is-light .progress-bar {
		background: rgb(21 128 61 / 20%);
	}

	.splash.is-light .corner-tl,
	.splash.is-light .corner-tr,
	.splash.is-light .corner-bl,
	.splash.is-light .corner-br {
		border-color: rgb(21 128 61 / 45%);
	}

	.scanline {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		background: linear-gradient(90deg, transparent, #22c55e, transparent);
		animation: scan 2s linear infinite;
		opacity: 0.6;
	}

	@keyframes scan {
		0% {
			top: 0;
		}
		100% {
			top: 100%;
		}
	}

	.corner-tl,
	.corner-tr,
	.corner-bl,
	.corner-br {
		position: absolute;
		width: 50px;
		height: 50px;
		border-color: rgb(34 197 94 / 50%);
		border-style: solid;
	}

	.corner-tl {
		top: 24px;
		left: 24px;
		border-width: 2px 0 0 2px;
	}

	.corner-tr {
		top: 24px;
		right: 24px;
		border-width: 2px 2px 0 0;
	}

	.corner-bl {
		bottom: 24px;
		left: 24px;
		border-width: 0 0 2px 2px;
	}

	.corner-br {
		bottom: 24px;
		right: 24px;
		border-width: 0 2px 2px 0;
	}

	.content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2rem;
		text-align: center;
		padding: 2rem;
		width: 100%;
		max-width: 100vw;
		overflow: hidden;
	}

	.logo-wrap {
		position: relative;
		width: min(420px, 80vw);
		height: min(420px, 80vw);
		display: flex;
		align-items: center;
		justify-content: center;
		opacity: 0;
		animation: logo-reveal 0.6s ease forwards;
	}

	.logo-glow {
		position: absolute;
		inset: -60px;
		background: radial-gradient(circle, rgb(34 197 94 / 15%) 0%, transparent 65%);
		animation: pulse 2s ease-in-out infinite;
		pointer-events: none;
	}

	.glitch-wrapper {
		position: relative;
		width: min(380px, 72vw);
		height: min(380px, 72vw);
		animation: logo-pulse 3s ease-in-out infinite;
		filter: drop-shadow(0 0 12px rgb(34 197 94 / 60%));
	}

	.logo-img {
		position: absolute;
		width: min(380px, 72vw);
		height: min(380px, 72vw);
		object-fit: contain;
		filter: invert(1) sepia(1) saturate(4) hue-rotate(100deg) brightness(0.9);
		mix-blend-mode: screen;
	}

	.glitch-r {
		opacity: 0.4;
		animation: glitch-r 4s infinite;
	}

	.glitch-b {
		filter: invert(1) sepia(1) saturate(2) hue-rotate(200deg) brightness(0.8);
		opacity: 0.25;
		animation: glitch-b 4s infinite;
	}

	.scanline-overlay {
		position: absolute;
		inset: 0;
		background: repeating-linear-gradient(
			0deg,
			transparent,
			transparent 3px,
			rgb(0 255 100 / 3%) 3px,
			rgb(0 255 100 / 3%) 4px
		);
		pointer-events: none;
		z-index: 2;
		animation: scan-overlay 8s linear infinite;
	}

	.title-wrap {
		animation: title-reveal 0.5s ease 0.3s both;
	}

	.title {
		font-family: "JetBrains Mono", "Courier New", monospace;
		font-size: clamp(2.2rem, 8vw, 4.8rem);
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #22c55e;
		text-shadow:
			0 0 20px rgb(34 197 94 / 60%),
			0 0 40px rgb(34 197 94 / 30%),
			0 0 80px rgb(34 197 94 / 15%);
		margin: 0;
		position: relative;
		animation: glitch 4s steps(20) infinite;
	}

	.title::before,
	.title::after {
		content: attr(data-text);
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		background: transparent;
	}

	.title::before {
		animation: glitch-before 2.5s steps(20) infinite;
		text-shadow: -2px 0 #0f0;
		opacity: 0.7;
		mix-blend-mode: screen;
	}

	.title::after {
		animation: glitch-after 3.5s steps(20) reverse infinite;
		color: #16a34a;
		text-shadow: 2px 0 #0a0;
		opacity: 0.6;
		mix-blend-mode: screen;
	}

	.subtitle {
		font-family: "JetBrains Mono", "Courier New", monospace;
		font-size: clamp(0.9rem, 2vw, 1.2rem);
		letter-spacing: 0.18em;
		color: rgb(34 197 94 / 85%);
		text-transform: uppercase;
		margin: 0;
		animation: fade-in 0.6s ease 0.7s both;
	}

	.progress-bar {
		width: 240px;
		height: 2px;
		background: rgb(34 197 94 / 15%);
		border-radius: 2px;
		overflow: hidden;
		animation: fade-in 0.3s ease 1s both;
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #22c55e, #4ade80);
		box-shadow: 0 0 8px #22c55e;
		animation: progress 2.8s ease forwards;
		animation-delay: 0.2s;
	}

	@keyframes logo-reveal {
		from {
			opacity: 0;
			transform: scale(0.8);
		}
		to {
			opacity: 1;
			transform: scale(1);
		}
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.5;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.15);
		}
	}

	@keyframes title-reveal {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@keyframes glitch {
		0%,
		96%,
		100% {
			opacity: 1;
		}
		97% {
			opacity: 0.92;
		}
		98% {
			opacity: 1;
		}
		99% {
			opacity: 0.95;
		}
	}

	@keyframes glitch-before {
		0% {
			clip-path: inset(0 0 90% 0);
			transform: translate(2px, 0);
		}
		20% {
			clip-path: inset(30% 0 50% 0);
			transform: translate(-2px, 0);
		}
		40% {
			clip-path: inset(60% 0 10% 0);
			transform: translate(1px, 0);
		}
		60% {
			clip-path: inset(10% 0 80% 0);
			transform: translate(-1px, 0);
		}
		80% {
			clip-path: inset(50% 0 30% 0);
			transform: translate(2px, 0);
		}
		100% {
			clip-path: inset(0 0 90% 0);
			transform: translate(0, 0);
		}
	}

	@keyframes glitch-after {
		0% {
			clip-path: inset(80% 0 0 0);
			transform: translate(-2px, 0);
		}
		20% {
			clip-path: inset(40% 0 40% 0);
			transform: translate(2px, 1px);
		}
		40% {
			clip-path: inset(0 0 70% 0);
			transform: translate(-1px, 0);
		}
		60% {
			clip-path: inset(70% 0 0 0);
			transform: translate(1px, 0);
		}
		80% {
			clip-path: inset(20% 0 60% 0);
			transform: translate(-2px, 0);
		}
		100% {
			clip-path: inset(80% 0 0 0);
			transform: translate(0, 0);
		}
	}

	@keyframes glitch-r {
		0%,
		90%,
		100% {
			transform: translate(0, 0);
			opacity: 0;
		}
		91% {
			transform: translate(-3px, 0);
			opacity: 0.4;
		}
		93% {
			transform: translate(3px, 1px);
			opacity: 0.35;
		}
		95% {
			transform: translate(0, 0);
			opacity: 0;
		}
	}

	@keyframes glitch-b {
		0%,
		88%,
		100% {
			transform: translate(0, 0);
			opacity: 0;
		}
		89% {
			transform: translate(3px, -1px);
			opacity: 0.25;
		}
		91% {
			transform: translate(-2px, 0);
			opacity: 0.2;
		}
		93% {
			transform: translate(0, 0);
			opacity: 0;
		}
	}

	@keyframes logo-pulse {
		0%,
		100% {
			filter: drop-shadow(0 0 14px rgb(34 197 94 / 70%))
				drop-shadow(0 0 30px rgb(34 197 94 / 30%));
		}
		50% {
			filter: drop-shadow(0 0 28px rgb(34 197 94 / 100%))
				drop-shadow(0 0 60px rgb(34 197 94 / 50%));
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes progress {
		from {
			width: 0%;
		}
		to {
			width: 100%;
		}
	}

	@keyframes scan-overlay {
		0% {
			background-position: 0 0;
		}
		100% {
			background-position: 0 300px;
		}
	}

	@media (max-width: 640px) {
		.content {
			gap: 1.4rem;
			padding: 1.2rem;
		}

		.subtitle {
			padding: 0 0.8rem;
			letter-spacing: 0.12em;
		}
	}
</style>
