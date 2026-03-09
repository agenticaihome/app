/**
 * Svelte action: use:hoverCorners
 * 
 * On hover, dispatches events so the custom cursor can hide its corners,
 * and renders 4 bracket corners on the element that track the mouse with parallax.
 */
export function hoverCorners(node: HTMLElement) {
	const CORNER_SIZE = 16;
	const BORDER_WIDTH = 2;
	const MARGIN = 6; // inset from element border
	const MAX_SHIFT = 8; // max parallax shift in px
	const originalPosition = node.style.position;

	// Ensure positioned
	const pos = getComputedStyle(node).position;
	if (pos === 'static') {
		node.style.position = 'relative';
	}
	node.classList.add('hc-target');

	// Create corner elements
	const corners: HTMLDivElement[] = [];
	const cornerPositions = ['tl', 'tr', 'br', 'bl'];

	for (const cp of cornerPositions) {
		const el = document.createElement('div');
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

		if (cp === 'tl') {
			el.style.top = `${MARGIN}px`;
			el.style.left = `${MARGIN}px`;
			el.style.borderRight = 'none';
			el.style.borderBottom = 'none';
		} else if (cp === 'tr') {
			el.style.top = `${MARGIN}px`;
			el.style.right = `${MARGIN}px`;
			el.style.borderLeft = 'none';
			el.style.borderBottom = 'none';
		} else if (cp === 'br') {
			el.style.bottom = `${MARGIN}px`;
			el.style.right = `${MARGIN}px`;
			el.style.borderLeft = 'none';
			el.style.borderTop = 'none';
		} else if (cp === 'bl') {
			el.style.bottom = `${MARGIN}px`;
			el.style.left = `${MARGIN}px`;
			el.style.borderRight = 'none';
			el.style.borderTop = 'none';
		}

		node.appendChild(el);
		corners.push(el);
	}

	const onEnter = () => {
		// Signal cursor to hide its corners
		window.dispatchEvent(new CustomEvent('hoverCornerEnter'));
		node.classList.add('hc-active');
		for (const c of corners) {
			c.style.opacity = '1';
		}
	};

	const onLeave = () => {
		// Signal cursor to show its corners again
		window.dispatchEvent(new CustomEvent('hoverCornerLeave'));
		node.classList.remove('hc-active');
		for (const c of corners) {
			c.style.opacity = '0';
			c.style.transform = 'translate(0, 0)';
		}
	};

	const onMove = (e: MouseEvent) => {
		const rect = node.getBoundingClientRect();
		const centerX = rect.left + rect.width / 2;
		const centerY = rect.top + rect.height / 2;
		const relX = (e.clientX - centerX) / (rect.width / 2); // -1 to 1
		const relY = (e.clientY - centerY) / (rect.height / 2); // -1 to 1
		const shiftX = relX * MAX_SHIFT;
		const shiftY = relY * MAX_SHIFT;

		// All corners shift in the same direction — tracks the mouse
		for (const c of corners) {
			c.style.transform = `translate(${shiftX}px, ${shiftY}px)`;
		}
	};

	node.addEventListener('mouseenter', onEnter);
	node.addEventListener('mouseleave', onLeave);
	node.addEventListener('mousemove', onMove);

	return {
		destroy() {
			node.removeEventListener('mouseenter', onEnter);
			node.removeEventListener('mouseleave', onLeave);
			node.removeEventListener('mousemove', onMove);
			node.classList.remove('hc-active');
			node.classList.remove('hc-target');
			if (pos === 'static') {
				node.style.position = originalPosition;
			}
			for (const c of corners) {
				c.remove();
			}
		}
	};
}
