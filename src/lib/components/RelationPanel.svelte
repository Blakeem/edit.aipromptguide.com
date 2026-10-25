<script lang="ts">
	import { replaceTarget, selectedWord, wordSectionStates } from '../stores.js';
	import { loadWordSection } from '../word-lookup.js';
	import { buildSenseGroups } from '../word-section-view.js';
	import type { RelationSectionId } from '../word-sections.js';
	import WordChip from './WordChip.svelte';

	export let sectionId: RelationSectionId;

	// This panel only mounts while open, so it fetches on open and on each new word.
	$: if ($selectedWord) loadWordSection(sectionId);

	$: sectionState = $wordSectionStates[sectionId];
	$: groups =
		sectionState?.status === 'ready' && sectionState.result.found
			? buildSenseGroups(sectionState.result.senses, sectionId)
			: [];
</script>

{#if !$selectedWord}
	<p class="panel-note">Click a word in the editor to look it up.</p>
{:else if !sectionState || sectionState.status === 'loading'}
	<p class="panel-note">Loading…</p>
{:else if sectionState.status === 'error'}
	<p class="panel-note error">Could not load this section</p>
{:else if !sectionState.result.found}
	<p class="panel-note">Not in WordNet</p>
{:else if groups.length === 0}
	<p class="panel-note">None for this word</p>
{:else}
	{#each groups as group (group.displayNumber)}
		<div class="sense-group">
			<div class="sense-group-header" title={group.definition}>
				<span class="sense-number">{group.displayNumber}</span>
				<span class="sense-group-pos">{group.pos}</span>
				<span class="sense-group-definition">{group.definition}</span>
			</div>

			{#if group.chain.length > 0}
				<div class="chip-list chain">
					{#each group.chain as rung, rungIndex (rungIndex)}
						{#if rungIndex > 0}
							<span class="chain-separator">›</span>
						{/if}
						<WordChip word={rung.word} title={rung.definition} replaceTarget={$replaceTarget} />
					{/each}
				</div>
			{/if}

			{#each group.rows as row (row.label ?? '')}
				<div class="chip-row">
					{#if row.label}
						<span class="row-label">{row.label}</span>
					{/if}
					<div class="chip-list">
						{#each row.targets as target (`${target.word}|${target.pos}`)}
							<WordChip
								word={target.word}
								pos={target.pos === group.pos ? null : target.pos}
								replaceTarget={$replaceTarget}
							/>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/each}
{/if}

<style>
	.panel-note {
		margin: 0;
		font-size: 0.875rem;
		color: var(--text-tertiary);
		font-style: italic;
	}

	.panel-note.error {
		color: var(--danger);
	}

	.sense-group {
		margin-bottom: 1rem;
	}

	.sense-group:last-child {
		margin-bottom: 0;
	}

	.sense-group-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
		min-width: 0;
	}

	.sense-number {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		background: var(--accent);
		color: white;
		border-radius: 50%;
		font-size: 0.75rem;
		font-weight: 600;
	}

	.sense-group-pos {
		flex-shrink: 0;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--accent);
	}

	.sense-group-definition {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
		color: var(--text-secondary);
	}

	.chip-list {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.375rem;
	}

	.chip-list.chain {
		margin-bottom: 0.5rem;
	}

	.chain-separator {
		color: var(--text-tertiary);
	}

	.chip-row {
		margin-bottom: 0.5rem;
	}

	.chip-row:last-child {
		margin-bottom: 0;
	}

	.row-label {
		display: block;
		margin-bottom: 0.25rem;
		font-size: 0.7rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}
</style>
