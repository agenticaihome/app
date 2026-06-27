export type RGB = { r: number; g: number; b: number; a: number };
export type CornerStyle = { color: string; filter: string };

const CORNER_COLOR_GREEN = "#22c55e";
const CORNER_COLOR_DARK = "#0b0b0b";
const CORNER_FILTER_GREEN = "drop-shadow(0 0 3px rgba(34,197,94,.6))";
const CORNER_FILTER_DARK = "drop-shadow(0 0 2px rgba(0,0,0,.45))";

type ParsedGradient = { angle: number; colors: [RGB, RGB] };
type BackgroundInfo = {
	bgImage: string;
	bgColor: string;
	gradient: ParsedGradient | null;
};

const bgCache = new WeakMap<HTMLElement, BackgroundInfo>();

function clamp01(value: number) {
	return Math.max(0, Math.min(1, value));
}

function parseHexChannel(value: string) {
	return parseInt(value, 16);
}

function parseColor(input: string): RGB | null {
	if (!input) return null;
	const value = input.trim().toLowerCase();
	if (value === "transparent") {
		return { r: 0, g: 0, b: 0, a: 0 };
	}
	if (value.startsWith("#")) {
		const hex = value.slice(1);
		if (hex.length === 3) {
			const r = parseHexChannel(hex[0] + hex[0]);
			const g = parseHexChannel(hex[1] + hex[1]);
			const b = parseHexChannel(hex[2] + hex[2]);
			return { r, g, b, a: 1 };
		}
		if (hex.length === 4) {
			const r = parseHexChannel(hex[0] + hex[0]);
			const g = parseHexChannel(hex[1] + hex[1]);
			const b = parseHexChannel(hex[2] + hex[2]);
			const a = parseHexChannel(hex[3] + hex[3]) / 255;
			return { r, g, b, a };
		}
		if (hex.length === 6 || hex.length === 8) {
			const r = parseHexChannel(hex.slice(0, 2));
			const g = parseHexChannel(hex.slice(2, 4));
			const b = parseHexChannel(hex.slice(4, 6));
			const a = hex.length === 8 ? parseHexChannel(hex.slice(6, 8)) / 255 : 1;
			return { r, g, b, a };
		}
		return null;
	}

	const rgbMatch = value.match(/rgba?\(([^)]+)\)/);
	if (rgbMatch) {
		const parts = rgbMatch[1].split(/[,/ ]+/).filter(Boolean);
		if (parts.length < 3) return null;
		const [rRaw, gRaw, bRaw, aRaw] = parts;
		const r = rRaw.endsWith("%") ? (parseFloat(rRaw) / 100) * 255 : parseFloat(rRaw);
		const g = gRaw.endsWith("%") ? (parseFloat(gRaw) / 100) * 255 : parseFloat(gRaw);
		const b = bRaw.endsWith("%") ? (parseFloat(bRaw) / 100) * 255 : parseFloat(bRaw);
		const a = aRaw !== undefined ? parseFloat(aRaw) : 1;
		return { r, g, b, a };
	}

	const hslMatch = value.match(/hsla?\(([^)]+)\)/);
	if (hslMatch) {
		const parts = hslMatch[1].split(/[,/ ]+/).filter(Boolean);
		if (parts.length < 3) return null;
		const h = parseFloat(parts[0]);
		const s = parseFloat(parts[1]) / 100;
		const l = parseFloat(parts[2]) / 100;
		const a = parts[3] !== undefined ? parseFloat(parts[3]) : 1;
		const c = (1 - Math.abs(2 * l - 1)) * s;
		const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
		const m = l - c / 2;
		let r1 = 0;
		let g1 = 0;
		let b1 = 0;
		if (h >= 0 && h < 60) {
			r1 = c;
			g1 = x;
		} else if (h >= 60 && h < 120) {
			r1 = x;
			g1 = c;
		} else if (h >= 120 && h < 180) {
			g1 = c;
			b1 = x;
		} else if (h >= 180 && h < 240) {
			g1 = x;
			b1 = c;
		} else if (h >= 240 && h < 300) {
			r1 = x;
			b1 = c;
		} else {
			r1 = c;
			b1 = x;
		}
		return {
			r: Math.round((r1 + m) * 255),
			g: Math.round((g1 + m) * 255),
			b: Math.round((b1 + m) * 255),
			a,
		};
	}

	return null;
}

function extractLinearGradient(value: string): string | null {
	const index = value.indexOf("linear-gradient(");
	if (index === -1) return null;
	let depth = 0;
	for (let i = index; i < value.length; i += 1) {
		const char = value[i];
		if (char === "(") depth += 1;
		if (char === ")") {
			depth -= 1;
			if (depth === 0) {
				return value.slice(index, i + 1);
			}
		}
	}
	return null;
}

function firstGradientToken(value: string): string {
	let depth = 0;
	for (let i = 0; i < value.length; i += 1) {
		const char = value[i];
		if (char === "(") depth += 1;
		if (char === ")") depth -= 1;
		if (char === "," && depth === 0) {
			return value.slice(0, i).trim();
		}
	}
	return value.trim();
}

function parseGradientAngle(token: string): number | null {
	const clean = token.trim().toLowerCase();
	if (clean.startsWith("to ")) {
		const dir = clean.replace(/\s+/g, " ");
		const map: Record<string, number> = {
			"to top": 0,
			"to top right": 45,
			"to right": 90,
			"to bottom right": 135,
			"to bottom": 180,
			"to bottom left": 225,
			"to left": 270,
			"to top left": 315,
		};
		return map[dir] ?? null;
	}
	if (clean.endsWith("deg")) {
		return parseFloat(clean);
	}
	if (clean.endsWith("turn")) {
		return parseFloat(clean) * 360;
	}
	if (clean.endsWith("rad")) {
		return (parseFloat(clean) * 180) / Math.PI;
	}
	return null;
}

function parseLinearGradient(input: string): ParsedGradient | null {
	const gradient = extractLinearGradient(input);
	if (!gradient) return null;
	const inner = gradient.slice(gradient.indexOf("(") + 1, -1);
	const token = firstGradientToken(inner);
	const angle = parseGradientAngle(token) ?? 180;
	const colorMatches =
		inner.match(/(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))/g) ?? [];
	const colors = colorMatches
		.map((match) => parseColor(match))
		.filter((color): color is RGB => Boolean(color));
	if (colors.length < 2) return null;
	return { angle, colors: [colors[0], colors[1]] };
}

function getBackgroundInfo(el: HTMLElement): BackgroundInfo {
	const style = getComputedStyle(el);
	const bgImage = style.backgroundImage || "none";
	const bgColor = style.backgroundColor || "transparent";
	const cached = bgCache.get(el);
	if (cached && cached.bgImage === bgImage && cached.bgColor === bgColor) {
		return cached;
	}
	const gradient = bgImage.includes("linear-gradient") ? parseLinearGradient(bgImage) : null;
	const info = { bgImage, bgColor, gradient };
	bgCache.set(el, info);
	return info;
}

function sampleGradient(
	gradient: ParsedGradient,
	rect: DOMRect,
	x: number,
	y: number,
): RGB {
	const angle = gradient.angle;
	const rad = ((angle - 90) * Math.PI) / 180;
	const dx = Math.cos(rad);
	const dy = Math.sin(rad);
	const halfW = rect.width / 2;
	const halfH = rect.height / 2;
	const corners = [
		[-halfW, -halfH],
		[halfW, -halfH],
		[halfW, halfH],
		[-halfW, halfH],
	];
	let min = Infinity;
	let max = -Infinity;
	for (const [cx, cy] of corners) {
		const dot = cx * dx + cy * dy;
		min = Math.min(min, dot);
		max = Math.max(max, dot);
	}
	const px = x - (rect.left + halfW);
	const py = y - (rect.top + halfH);
	const dot = px * dx + py * dy;
	const t = max === min ? 0 : clamp01((dot - min) / (max - min));
	const [c1, c2] = gradient.colors;
	return {
		r: Math.round(c1.r + (c2.r - c1.r) * t),
		g: Math.round(c1.g + (c2.g - c1.g) * t),
		b: Math.round(c1.b + (c2.b - c1.b) * t),
		a: Math.max(c1.a, c2.a),
	};
}

function getBackgroundColorAtPoint(
	el: HTMLElement,
	x: number,
	y: number,
): RGB | null {
	let current: HTMLElement | null = el;
	while (current) {
		const info = getBackgroundInfo(current);
		if (info.gradient) {
			return sampleGradient(info.gradient, current.getBoundingClientRect(), x, y);
		}
		const color = parseColor(info.bgColor);
		if (color && color.a > 0.05) {
			return color;
		}
		current = current.parentElement;
	}
	return null;
}

function rgbToHsl(color: RGB) {
	const r = color.r / 255;
	const g = color.g / 255;
	const b = color.b / 255;
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	let h = 0;
	let s = 0;
	const l = (max + min) / 2;
	if (max !== min) {
		const d = max - min;
		s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
		switch (max) {
			case r:
				h = (g - b) / d + (g < b ? 6 : 0);
				break;
			case g:
				h = (b - r) / d + 2;
				break;
			default:
				h = (r - g) / d + 4;
		}
		h *= 60;
	}
	return { h, s, l };
}

function isGreenish(color: RGB): boolean {
	if (color.a < 0.1) return false;
	const { h, s, l } = rgbToHsl(color);
	return h >= 80 && h <= 160 && s >= 0.25 && l >= 0.2;
}

function resolveColorAtPoint(
	x: number,
	y: number,
	preferredRoot?: HTMLElement,
): RGB | null {
	if (preferredRoot) {
		const rootColor = getBackgroundColorAtPoint(preferredRoot, x, y);
		if (rootColor) return rootColor;
	}
	const el = document.elementFromPoint(x, y) as HTMLElement | null;
	if (!el) return null;
	return getBackgroundColorAtPoint(el, x, y);
}

export function getAdaptiveCornerStyle(
	x: number,
	y: number,
	preferredRoot?: HTMLElement,
): CornerStyle {
	const color = resolveColorAtPoint(x, y, preferredRoot);
	if (color && isGreenish(color)) {
		return { color: CORNER_COLOR_DARK, filter: CORNER_FILTER_DARK };
	}
	return { color: CORNER_COLOR_GREEN, filter: CORNER_FILTER_GREEN };
}
