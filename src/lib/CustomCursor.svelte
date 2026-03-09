<script lang="ts">
	import { onMount } from 'svelte';

	let wrapper: HTMLDivElement;

	onMount(() => {
		const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		if (isTouch || window.matchMedia('(max-width:768px)').matches) return;

		document.body.classList.add('has-custom-cursor');
		document.documentElement.classList.add('has-custom-cursor');

		const cornersWrapper = wrapper.querySelector('.corners-ring') as HTMLElement;
		const dot = wrapper.querySelector('.tcd') as HTMLElement;

		let raf: number;
		let curX = window.innerWidth / 2;
		let curY = window.innerHeight / 2;

		function showCursorCorners() {
			cornersWrapper.style.opacity = '1';
			dot.style.opacity = '1';
			cornersWrapper.style.animationPlayState = 'running';
		}

		function hideCursorCorners() {
			cornersWrapper.style.opacity = '0';
			dot.style.opacity = '0';
			cornersWrapper.style.animationPlayState = 'paused';
		}

		// Listen for hover corner transfer events
		const onHoverEnter = () => hideCursorCorners();
		const onHoverLeave = () => showCursorCorners();

		window.addEventListener('hoverCornerEnter', onHoverEnter);
		window.addEventListener('hoverCornerLeave', onHoverLeave);

		const onMove = (e: MouseEvent) => {
			cancelAnimationFrame(raf);
			curX = e.clientX;
			curY = e.clientY;
			raf = requestAnimationFrame(() => {
				wrapper.style.left = curX + 'px';
				wrapper.style.top = curY + 'px';
				wrapper.style.opacity = '1';
			});
		};

		document.addEventListener('mousemove', onMove, { passive: true });

		return () => {
			cancelAnimationFrame(raf);
			document.body.classList.remove('has-custom-cursor');
			document.documentElement.classList.remove('has-custom-cursor');
			document.removeEventListener('mousemove', onMove);
			window.removeEventListener('hoverCornerEnter', onHoverEnter);
			window.removeEventListener('hoverCornerLeave', onHoverLeave);
		};
	});
</script>

<div bind:this={wrapper} class="tcw" aria-hidden="true">
	<div class="tcd"></div>
	<div class="corners-ring">
		<div class="tcc tl"></div>
		<div class="tcc tr"></div>
		<div class="tcc br"></div>
		<div class="tcc bl"></div>
	</div>
</div>

<style>
	:global(html.has-custom-cursor),
	:global(html.has-custom-cursor *),
	:global(body.has-custom-cursor),
	:global(body.has-custom-cursor *) { cursor: none !important; }

	.tcw {
		position: fixed;
		top: 0; left: 0;
		width: 0; height: 0;
		pointer-events: none;
		z-index: 99999;
		transform: translate(-50%, -50%);
		opacity: 0;
	}

	.tcd {
		position: absolute;
		left: 50%; top: 50%;
		width: 5px; height: 5px;
		background: #22c55e;
		border-radius: 50%;
		transform: translate(-50%, -50%);
		box-shadow: 0 0 10px #22c55ecc, 0 0 20px #22c55e66;
		transition: opacity 0.2s ease;
		z-index: 2;
	}

	.corners-ring {
		position: absolute;
		left: 50%; top: 50%;
		width: 0; height: 0;
		transform: translate(-50%, -50%);
		animation: cursorRotate 9s linear infinite, cursorBreathe 3.5s ease-in-out infinite;
		transition: opacity 0.25s ease;
		z-index: 1;
	}

	@keyframes cursorRotate {
		from { rotate: 0deg; }
		to { rotate: 360deg; }
	}

	@keyframes cursorBreathe {
		0%, 100% { scale: 1; }
		50% { scale: 1.25; }
	}

	.tcc {
		position: absolute;
		left: 50%; top: 50%;
		width: 13px; height: 13px;
		border: 2px solid #22c55e;
		filter: drop-shadow(0 0 3px rgba(34,197,94,.6));
	}

	/* Corner bracket positions — offset from center */
	.tl { transform: translate(-19.5px, -19.5px); border-right: none; border-bottom: none; }
	.tr { transform: translate(6.5px,  -19.5px);  border-left:  none; border-bottom: none; }
	.br { transform: translate(6.5px,   6.5px);   border-left:  none; border-top:    none; }
	.bl { transform: translate(-19.5px, 6.5px);   border-right: none; border-top:    none; }

	@media (prefers-reduced-motion: reduce) {
		.corners-ring {
			animation: none;
		}
	}
</style>
