<script lang="ts">
	import {
		openWordSections,
		selectedWord,
		toggleWordSection,
		wordPanelOpen,
		wordSectionStates
	} from '../stores.js';
	import type { WordSectionStates } from '../stores.js';
	import { clearSelection } from '../word-lookup.js';
	import { buildSenseGroups, countGroupWords, SECTION_TITLES } from '../word-section-view.js';
	import { WORD_SECTION_IDS } from '../word-sections.js';
	import type { WordSectionId } from '../word-sections.js';
	import DictionaryPanel from './DictionaryPanel.svelte';
	import RelationPanel from './RelationPanel.svelte';

	// A count shows only once a panel's data has loaded, since closed panels fetch nothing.
	// Dictionary counts meanings. Every other panel counts its distinct words.
	function panelCount(sectionId: WordSectionId, states: WordSectionStates): number | null {
		if (sectionId === 'dictionary') {
			const dictionaryState = states.dictionary;
			return dictionaryState?.status === 'ready' && dictionaryState.result.found
				? dictionaryState.result.senses.length
				: null;
		}

		const sectionState = states[sectionId];
		return sectionState?.status === 'ready' && sectionState.result.found
			? countGroupWords(buildSenseGroups(sectionState.result.senses, sectionId))
			: null;
	}
</script>

<div class="word-sidebar">
	<div class="sidebar-top">
		{#if $selectedWord}
			<span class="label">Selected word</span>
			<span class="word">{$selectedWord}</span>
			<button class="icon-btn clear-btn" onclick={clearSelection} title="Clear selection">
				<svg
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
				>
					<line x1="18" y1="6" x2="6" y2="18" />
					<line x1="6" y1="6" x2="18" y2="18" />
				</svg>
			</button>
		{:else}
			<span class="label">No word selected</span>
		{/if}
		<button
			class="icon-btn collapse-btn"
			onclick={() => wordPanelOpen.set(false)}
			title="Collapse sidebar"
			aria-label="Collapse sidebar"
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
				<polyline points="9 18 15 12 9 6" />
			</svg>
		</button>
	</div>

	<div class="panels">
		{#each WORD_SECTION_IDS as sectionId (sectionId)}
			{@const isOpen = $openWordSections.includes(sectionId)}
			{@const count = panelCount(sectionId, $wordSectionStates)}
			<section class="panel" class:open={isOpen}>
				<button
					class="panel-header"
					aria-expanded={isOpen}
					onclick={() => toggleWordSection(sectionId)}
				>
					<svg
						class="chevron"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="9 18 15 12 9 6" />
					</svg>
					<span class="panel-title">{SECTION_TITLES[sectionId]}</span>
					{#if count !== null}
						<span class="panel-count" class:empty={count === 0}>{count}</span>
					{/if}
				</button>

				{#if isOpen}
					<div class="panel-body">
						{#if sectionId === 'dictionary'}
							<DictionaryPanel />
						{:else}
							<RelationPanel {sectionId} />
						{/if}
					</div>
				{/if}
			</section>
		{/each}
	</div>
</div>

<style>
	.word-sidebar {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}

	.sidebar-top {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.75rem;
		padding: 0.625rem 0.75rem 0.625rem 1rem;
		background: linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-secondary) 100%);
		border-bottom: 2px solid var(--accent);
	}

	.label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 500;
	}

	.word {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 1.125rem;
		color: var(--accent);
		font-weight: 700;
		font-family: var(--font-family);
	}

	.icon-btn {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--border);
		background: var(--bg-primary);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.clear-btn {
		border-radius: 50%;
	}

	.clear-btn:hover {
		background: var(--danger-bg);
		color: var(--danger);
		border-color: var(--danger);
	}

	.collapse-btn {
		margin-left: auto;
		border-radius: 6px;
	}

	.collapse-btn:hover {
		background: var(--bg-hover);
		color: var(--accent);
		border-color: var(--accent);
	}

	/* Open panels size to their content and shrink in proportion to it when they share the
	   height. Each keeps enough room to show a few lines, and the stack scrolls past that. */
	.panels {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
	}

	.panel {
		display: flex;
		flex: none;
		flex-direction: column;
		border-bottom: 1px solid var(--border);
	}

	.panel.open {
		flex: 0 1 auto;
		min-height: 9rem;
	}

	.panel-header {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		padding: 0.625rem 1rem;
		border: none;
		background: var(--bg-secondary);
		color: var(--text-primary);
		font-size: 0.9rem;
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}

	.panel-header:hover {
		background: var(--bg-hover);
	}

	.chevron {
		flex-shrink: 0;
		color: var(--text-secondary);
		transition: transform 0.15s ease;
	}

	.panel.open .chevron {
		transform: rotate(90deg);
	}

	.panel-title {
		flex: 1;
	}

	.panel-count {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 10px;
		padding: 0 0.5rem;
	}

	.panel-count.empty {
		color: var(--text-tertiary);
	}

	.panel-body {
		flex: 1 1 auto;
		min-height: 0;
		padding: 1rem;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}
</style>
