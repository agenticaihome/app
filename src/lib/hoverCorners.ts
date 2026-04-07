/**
 * Svelte action: use:hoverCorners
 * 
 * On hover, dispatches events so the custom cursor can hide its corners,
 * and renders 4 bracket corners on the element that track the mouse with parallax.
 */
import { getAdaptiveCornerStyle } from "$lib/cornerColor";

export function hoverCorners(
	node: HTMLElement,
	options: { keepDot?: boolean } = {},
) {
	const CORNER_SIZE = 16;
	const BORDER_WIDTH = 2;
	const MARGIN = 6; // inset from element border
	const MAX_SHIFT = 8; // max parallax shift in px
	const originalPosition = node.style.position;
	const isFormControl =
		node instanceof HTMLInputElement ||
		node instanceof HTMLTextAreaElement ||
		node instanceof HTMLSelectElement ||
		node.getAttribute("role") === "combobox";
	let isActive = false;

	// Ensure positioned
	const pos = getComputedStyle(node).position;
	const didAdjustPosition = !isFormControl && pos === "static";
	if (didAdjustPosition) {
		node.style.position = "relative";
	}
	node.classList.add('hc-target');

	const overlay = isFormControl ? document.createElement("div") : null;
	if (overlay) {
		overlay.className = "hc-overlay";
		overlay.style.cssText = `
			position: fixed;
			left: 0;
			top: 0;
			width: 0;
			height: 0;
			pointer-events: none;
			z-index: 99998;
			opacity: 0;
		`;
		document.body.appendChild(overlay);
	}

	function applyCornerStyle(el: HTMLDivElement, x: number, y: number) {
		const style = getAdaptiveCornerStyle(x, y, node);
		el.style.borderColor = style.color;
		el.style.filter = style.filter;
	}

	function createCorners(container: HTMLElement) {
		const corners: HTMLDivElement[] = [];
		const cornerPositions = ["tl", "tr", "br", "bl"];

		for (const cp of cornerPositions) {
			const el = document.createElement("div");
			el.className = `hc-corner hc-${cp}`;
			el.style.cssText = `
				position: absolute;
				width: ${CORNER_SIZE}px;
				height: ${CORNER_SIZE}px;
				border: ${BORDER_WIDTH}px solid #22c55e;
				pointer-events: none;
				opacity: 0;
				transition: opacity 0.2s ease, transform 0.15s ease;
				z-index: 3;
				will-change: transform, opacity;
				filter: drop-shadow(0 0 3px rgba(34,197,94,.6));
			`;

			if (cp === "tl") {
				el.style.top = `${MARGIN}px`;
				el.style.left = `${MARGIN}px`;
				el.style.borderRight = "none";
				el.style.borderBottom = "none";
			} else if (cp === "tr") {
				el.style.top = `${MARGIN}px`;
				el.style.right = `${MARGIN}px`;
				el.style.borderLeft = "none";
				el.style.borderBottom = "none";
			} else if (cp === "br") {
				el.style.bottom = `${MARGIN}px`;
				el.style.right = `${MARGIN}px`;
				el.style.borderLeft = "none";
				el.style.borderTop = "none";
			} else if (cp === "bl") {
				el.style.bottom = `${MARGIN}px`;
				el.style.left = `${MARGIN}px`;
				el.style.borderRight = "none";
				el.style.borderTop = "none";
			}

			container.appendChild(el);
			corners.push(el);
		}

		return corners;
	}

	const cornerHost = overlay ?? node;
	const corners = createCorners(cornerHost);
	let colorRaf: number | null = null;
	let lastShiftX = 0;
	let lastShiftY = 0;

	function updateOverlayRect(rect?: DOMRect) {
		if (!overlay) return;
		const r = rect ?? node.getBoundingClientRect();
		overlay.style.left = `${r.left}px`;
		overlay.style.top = `${r.top}px`;
		overlay.style.width = `${r.width}px`;
		overlay.style.height = `${r.height}px`;
	}

	function updateCornerColors(rect?: DOMRect) {
		const r = rect ?? node.getBoundingClientRect();
		const xLeft = r.left + MARGIN + CORNER_SIZE / 2 + lastShiftX;
		const xRight = r.right - (MARGIN + CORNER_SIZE / 2) + lastShiftX;
		const yTop = r.top + MARGIN + CORNER_SIZE / 2 + lastShiftY;
		const yBottom = r.bottom - (MARGIN + CORNER_SIZE / 2) + lastShiftY;
		const points = [
			{ x: xLeft, y: yTop },
			{ x: xRight, y: yTop },
			{ x: xRight, y: yBottom },
			{ x: xLeft, y: yBottom },
		];
		points.forEach((point, index) => {
			const corner = corners[index];
			if (!corner) return;
			applyCornerStyle(corner, point.x, point.y);
		});
	}

	function scheduleCornerColorUpdate(rect?: DOMRect) {
		if (colorRaf) return;
		colorRaf = requestAnimationFrame(() => {
			colorRaf = null;
			updateCornerColors(rect);
		});
	}

	const onViewportChange = () => {
		updateOverlayRect();
		scheduleCornerColorUpdate();
	};

	const onEnter = () => {
		if (isActive) return;
		isActive = true;
		// Signal cursor to hide its corners
		window.dispatchEvent(
			new CustomEvent('hoverCornerEnter', {
				detail: { keepDot: Boolean(options.keepDot) || isFormControl },
			}),
		);
		node.classList.add('hc-active');
		updateOverlayRect();
		scheduleCornerColorUpdate();
		if (overlay) overlay.style.opacity = "1";
		for (const c of corners) {
			c.style.opacity = '1';
		}
		window.addEventListener("scroll", onViewportChange, true);
		window.addEventListener("resize", onViewportChange);
	};

	const onLeave = () => {
		if (!isActive) return;
		isActive = false;
		// Signal cursor to show its corners again
		window.dispatchEvent(new CustomEvent('hoverCornerLeave'));
		node.classList.remove('hc-active');
		if (overlay) overlay.style.opacity = "0";
		for (const c of corners) {
			c.style.opacity = '0';
			c.style.transform = 'translate(0, 0)';
		}
		lastShiftX = 0;
		lastShiftY = 0;
		if (colorRaf) {
			cancelAnimationFrame(colorRaf);
			colorRaf = null;
		}
		window.removeEventListener("scroll", onViewportChange, true);
		window.removeEventListener("resize", onViewportChange);
	};

	const onMove = (e: MouseEvent) => {
		const rect = node.getBoundingClientRect();
		updateOverlayRect(rect);
		scheduleCornerColorUpdate(rect);
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const relX = (e.clientX - centerX) / (rect.width / 2); // -1 to 1
		const relY = (e.clientY - centerY) / (rect.height / 2); // -1 to 1
		const shiftX = relX * MAX_SHIFT;
		const shiftY = relY * MAX_SHIFT;
		lastShiftX = shiftX;
		lastShiftY = shiftY;

		// All corners shift in the same direction — tracks the mouse
		for (const c of corners) {
			c.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
		}
	};

	node.addEventListener('mouseenter', onEnter);
	node.addEventListener('mouseleave', onLeave);
	node.addEventListener('mousemove', onMove);
	node.addEventListener("pointerenter", onEnter);
	node.addEventListener("pointerleave", onLeave);
	if (isFormControl) {
		node.addEventListener("focus", onEnter);
		node.addEventListener("blur", onLeave);
	}

	return {
		destroy() {
			node.removeEventListener('mouseenter', onEnter);
			node.removeEventListener('mouseleave', onLeave);
			node.removeEventListener('mousemove', onMove);
			node.removeEventListener("pointerenter", onEnter);
			node.removeEventListener("pointerleave", onLeave);
			if (isFormControl) {
				node.removeEventListener("focus", onEnter);
				node.removeEventListener("blur", onLeave);
			}
			node.classList.remove('hc-active');
			node.classList.remove('hc-target');
			if (didAdjustPosition) {
				node.style.position = originalPosition;
			}
			if (colorRaf) {
				cancelAnimationFrame(colorRaf);
				colorRaf = null;
			}
			window.removeEventListener("scroll", onViewportChange, true);
			window.removeEventListener("resize", onViewportChange);
			for (const c of corners) {
				c.remove();
			}
			if (overlay) {
				overlay.remove();
			}
		}
	};
}
