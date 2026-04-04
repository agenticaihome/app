import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/kit/vite';

const base = process.env.BASE_PATH ?? (process.env.NODE_ENV === 'production'
	? `/${(process.env.GITHUB_REPOSITORY ?? '').split('/')[1] ?? ''}`.replace(/\/$/, '')
	: '');

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),

	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html'
		}),
		paths: {
			base
		}
	}
};

export default config;
