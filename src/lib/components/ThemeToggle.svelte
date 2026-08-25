<script lang="ts">
	import { isDarkMode } from '../stores.js';

	function toggleTheme() {
		isDarkMode.update((dark) => !dark);
	}
</script>

<button
	class="theme-toggle"
	onclick={toggleTheme}
	title={$isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
	aria-label="Toggle theme"
>
	{#if $isDarkMode}
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<circle cx="12" cy="12" r="5" />
			<path
				d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
			/>
		</svg>
	{:else}
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
		</svg>
	{/if}
</button>

<style>
	.theme-toggle {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 40px;
		height: 40px;
		border: 1px solid var(--border);
		background: var(--bg-primary);
		color: var(--text-primary);
		border-radius: 8px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.theme-toggle:hover {
		background: var(--bg-hover);
		border-color: var(--accent);
		color: var(--accent);
	}

	.theme-toggle:active {
		transform: scale(0.95);
	}
</style>
