<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { expandWordPanel, isDarkMode, saveState, wordPanelOpen } from '../lib/stores.js';
	import TabBar from '../lib/components/TabBar.svelte';
	import ThemeToggle from '../lib/components/ThemeToggle.svelte';
	import TextEditor from '../lib/components/TextEditor.svelte';
	import WordSidebar from '../lib/components/WordSidebar.svelte';
	import AutoSaveStatus from '../lib/components/AutoSaveStatus.svelte';

	// Auto-save interval
	let autoSaveInterval: NodeJS.Timeout;

	onMount(() => {
		// Save on page unload and visibility changes
		const handleBeforeUnload = () => {
			saveState();
		};

		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') {
				saveState();
			}
		};

		const handleBlur = () => {
			saveState();
		};

		// Auto-save every 10 seconds (lighter than before)
		autoSaveInterval = setInterval(() => {
			saveState();
		}, 10000);

		window.addEventListener('beforeunload', handleBeforeUnload);
		document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('blur', handleBlur);

		return () => {
			window.removeEventListener('beforeunload', handleBeforeUnload);
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('blur', handleBlur);
		};
	});

	onDestroy(() => {
		if (autoSaveInterval) {
			clearInterval(autoSaveInterval);
		}
	});
</script>

<div class="app" class:dark={$isDarkMode}>
	<header class="app-header">
		<div class="header-left">
			<h1>AI Prompt Guide Editor</h1>
		</div>

		<div class="header-right">
			<ThemeToggle />
		</div>
	</header>

	<TabBar />

	<main class="app-main" class:panel-collapsed={!$wordPanelOpen}>
		<div class="editor-section">
			<TextEditor />
		</div>

		<div class="sidebar-section">
			{#if $wordPanelOpen}
				<WordSidebar />
			{:else}
				<button
					class="sidebar-rail"
					onclick={expandWordPanel}
					title="Expand sidebar"
					aria-label="Expand sidebar"
				>
					<svg
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="15 18 9 12 15 6" />
					</svg>
					<span class="rail-icon">📖</span>
				</button>
			{/if}
		</div>
	</main>

	<AutoSaveStatus />
</div>

<style>
	:global(:root) {
		/* Light theme variables */
		--bg-primary: #ffffff;
		--bg-secondary: #f8f9fa;
		--bg-hover: #f1f3f4;
		--text-primary: #202124;
		--text-secondary: #5f6368;
		--text-tertiary: #9aa0a6;
		--border: #dadce0;
		--accent: #1a73e8;
		--accent-hover: #1557b0;
		--accent-bg: #e8f0fe;
		--success: #137333;
		--success-bg: #e6f4ea;
		--warning: #ea8600;
		--warning-bg: #fef7e0;
		--danger: #d93025;
		--danger-bg: #fce8e6;

		/* Academic typography */
		--font-family: 'Charter', 'Georgia', 'Times New Roman', serif;
		--font-family-mono: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
		--font-family-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	:global(body) {
		margin: 0;
		padding: 0;
		font-family: var(--font-family-sans);
		background: var(--bg-secondary);
		color: var(--text-primary);
		transition:
			background-color 0.2s ease,
			color 0.2s ease;
	}

	.app {
		height: 100vh;
		display: flex;
		flex-direction: column;
		background: var(--bg-secondary);
	}

	/* Dark theme */
	.app.dark {
		--bg-primary: #1f1f1f;
		--bg-secondary: #2d2d2d;
		--bg-hover: #3c3c3c;
		--text-primary: #e8eaed;
		--text-secondary: #9aa0a6;
		--text-tertiary: #5f6368;
		--border: #5f6368;
		--accent: #8ab4f8;
		--accent-hover: #aecbfa;
		--accent-bg: #1e3a8a;
		--success: #81c995;
		--success-bg: #0d5016;
		--warning: #fdd663;
		--warning-bg: #3d2914;
		--danger: #f28b82;
		--danger-bg: #5d1a1a;
	}

	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1rem 2rem;
		background: var(--bg-primary);
		border-bottom: 1px solid var(--border);
		box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
	}

	.header-left h1 {
		margin: 0;
		font-size: 1.5rem;
		color: var(--text-primary);
		font-weight: 600;
		font-family: var(--font-family);
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.app-main {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr 400px;
		gap: 1rem;
		padding: 1rem;
		overflow: hidden;
	}

	/* Collapsed: editor takes the freed width, sidebar becomes a slim rail.
       Two-class selector so it wins over the responsive .app-main overrides. */
	.app-main.panel-collapsed {
		grid-template-columns: 1fr 40px;
	}

	.editor-section {
		display: flex;
		flex-direction: column;
	}

	.sidebar-section {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}

	/* Slim collapsed rail with a clear expand affordance */
	.sidebar-rail {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.75rem;
		width: 100%;
		height: 100%;
		padding: 0.75rem 0;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.sidebar-rail:hover {
		background: var(--bg-hover);
		color: var(--accent);
		border-color: var(--accent);
	}

	.rail-icon {
		font-size: 1.1rem;
		line-height: 1;
	}

	@media (max-width: 1200px) {
		.app-main {
			grid-template-columns: 1fr 350px;
		}
	}

	@media (max-width: 768px) {
		.app-header {
			padding: 1rem;
		}

		.header-left h1 {
			font-size: 1.25rem;
		}

		.app-main {
			grid-template-columns: 1fr;
			grid-template-rows: 1fr auto;
			gap: 0.5rem;
			padding: 0.5rem;
		}

		.sidebar-section {
			grid-row: 2;
			max-height: 300px;
		}

		/* Collapsed on mobile: keep the rail as a slim right column */
		.app-main.panel-collapsed {
			grid-template-columns: 1fr 40px;
			grid-template-rows: 1fr;
		}

		.app-main.panel-collapsed .sidebar-section {
			grid-row: auto;
			max-height: none;
		}
	}
</style>
