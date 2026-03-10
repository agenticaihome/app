<script lang="ts">
	import { onMount } from "svelte";
	import { hoverCorners } from "$lib/hoverCorners";

	type HoverHandle = { destroy: () => void };

	const TARGET_SELECTOR = [
		"button",
		"[role='button']",
		".card",
		"[data-hover-corners]",
		"a[class*='btn']",
		"a[class*='button']",
		"a[class*='gop-btn']",
		"a.btn",
		"a.btn-primary",
		"a.btn-secondary",
		"a.gop-btn-primary",
		"a.logo-container",
		".nav-links > li > a",
		".mobile-nav-links > li > a",
		".page-footer a",
		".search-container input",
		".search-container select",
		".status-filter select",
		"input[type='search']",
		"input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='range']):not([type='file']):not([type='color']):not([type='submit']):not([type='reset']):not([type='button'])",
		"textarea",
		"select",
		"[role='combobox']",
	].join(", ");
	const SKIP_SELECTOR =
		".no-hover-corners, .tcw, .tcd, .corners-ring, .tcc, .hc-corner";

	const handles = new Map<HTMLElement, HoverHandle>();

	function shouldAttach(node: HTMLElement): boolean {
		if (handles.has(node) || !node.isConnected) return false;
		// Exception requested: do not apply moving corner brackets to game cards.
		if (node.matches(".gop-game-card, .game-card")) return false;
		if (node.matches(SKIP_SELECTOR) || node.closest(SKIP_SELECTOR)) return false;
		if (node.hasAttribute("disabled")) return false;
		if (node.getAttribute("aria-disabled") === "true") return false;
		const rect = node.getBoundingClientRect();
		const vw = window.innerWidth || document.documentElement.clientWidth;
		const vh = window.innerHeight || document.documentElement.clientHeight;
		// Avoid full-screen overlays (e.g., modal backdrops with role="button").
		if (rect.width > vw * 0.7 && rect.height > vh * 0.7) return false;
		if (rect.width < 18 || rect.height < 18) return false;
		return true;
	}

	function register(node: HTMLElement) {
		if (!shouldAttach(node)) return;
		handles.set(node, hoverCorners(node));
	}

	function scanNode(root: HTMLElement | Document) {
		if (root instanceof HTMLElement && root.matches(TARGET_SELECTOR)) {
			register(root);
		}
		root.querySelectorAll<HTMLElement>(TARGET_SELECTOR).forEach(register);
	}

	function unmountNode(root: HTMLElement) {
		const direct = handles.get(root);
		if (direct) {
			direct.destroy();
			handles.delete(root);
		}
		root.querySelectorAll<HTMLElement>(TARGET_SELECTOR).forEach((node) => {
			const handle = handles.get(node);
			if (!handle) return;
			handle.destroy();
			handles.delete(node);
		});
	}

	onMount(() => {
		const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
		if (isTouch || window.matchMedia("(max-width:768px)").matches) return;

		scanNode(document);

		const observer = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				for (const added of mutation.addedNodes) {
					if (added instanceof HTMLElement) {
						scanNode(added);
					}
				}
				for (const removed of mutation.removedNodes) {
					if (removed instanceof HTMLElement) {
						unmountNode(removed);
					}
				}
			}
		});

		observer.observe(document.body, { childList: true, subtree: true });

		return () => {
			observer.disconnect();
			for (const handle of handles.values()) {
				handle.destroy();
			}
			handles.clear();
		};
	});
</script>
