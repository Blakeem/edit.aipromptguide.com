<script lang="ts">
	import { selectedWord, wordSectionStates } from '../stores.js';
	import { loadWordSection } from '../word-lookup.js';
	import type { Pronunciation } from '../word-lookup.js';

	// The API carries one pronunciation per part of speech. The header shows no part of
	// speech, so identical IPA/variety pairs would otherwise repeat (fox: 4 rows, 2 sounds).
	function dedupePronunciations(all: Pronunciation[]): Pronunciation[] {
		// Input collection
		const unique: Pronunciation[] = [];
		// A local inside a pure function, never component state, so it needs no reactive Set.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const seen = new Set<string>();

		// Processing
		for (const pronunciation of all) {
			const key = JSON.stringify([pronunciation.ipa, pronunciation.variety]);

			if (seen.has(key)) continue;
			seen.add(key);
			unique.push(pronunciation);
		}

		// Output construction
		return unique;
	}

	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

	// This panel only mounts while open, so it fetches on open and on each new word.
	$: if ($selectedWord) loadWordSection('dictionary');

	$: dictionaryState = $wordSectionStates.dictionary;
	$: entry =
		dictionaryState?.status === 'ready' && dictionaryState.result.found
			? dictionaryState.result
			: null;
	$: pronunciations = entry ? dedupePronunciations(entry.pronunciations) : [];
</script>

{#if !$selectedWord}
	<div class="placeholder">
		<div class="placeholder-icon">
			<svg
				width="48"
				height="48"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="1.5"
			>
				<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
				<polyline points="14,2 14,8 20,8" />
				<line x1="16" y1="13" x2="8" y2="13" />
				<line x1="16" y1="17" x2="8" y2="17" />
				<polyline points="10,9 9,9 8,9" />
			</svg>
		</div>
		<p>Click on a word in the editor to explore its definition and relationships</p>
		<p class="hint">💡 Use Ctrl+Arrow keys to navigate between words</p>
	</div>
{:else if !dictionaryState || dictionaryState.status === 'loading'}
	<div class="loading">
		<svg
			class="spinner"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
		>
			<path d="M21 12a9 9 0 11-6.219-8.56" />
		</svg>
		Loading word data...
	</div>
{:else if dictionaryState.status === 'error'}
	<div class="error">
		<p>Failed to fetch word data</p>
	</div>
{:else if !entry}
	<div class="not-found">
		<p>Word "{$selectedWord}" not found in WordNet</p>
		<p class="suggestion">Try searching for a different word or check the spelling.</p>
	</div>
{:else}
	<div class="word-header">
		<h3>{entry.display_word}</h3>
		{#if pronunciations.length > 0}
			<div class="pronunciations">
				{#each pronunciations as pronunciation (pronunciation)}
					<span class="pronunciation">
						<span class="ipa">/{pronunciation.ipa}/</span>
						{#if pronunciation.variety}
							<span class="variety">{pronunciation.variety}</span>
						{/if}
					</span>
				{/each}
			</div>
		{/if}
		{#if entry.was_variation}
			<p class="variation-note">
				Showing <strong>{entry.display_word}</strong> for "{entry.searched_word}"
			</p>
		{/if}
		<div class="word-stats">
			<span class="stat">{plural(entry.total_senses, 'sense')}</span>
			<span class="stat">{plural(entry.stats.total_definitions, 'definition')}</span>
			<span class="stat">{plural(entry.stats.total_examples, 'example')}</span>
		</div>
	</div>

	{#each entry.senses as sense, i (sense)}
		<div class="sense">
			<div class="sense-info">
				<span class="sense-number">{i + 1}</span>
				<span class="pos">{sense.pos}</span>
				{#if sense.domain}
					<span class="domain">{sense.domain}</span>
				{/if}
				{#if (sense.tagcount ?? 0) >= 1}
					<span class="common">common</span>
				{/if}
			</div>

			<p class="definition">{sense.definition}</p>

			{#if sense.examples.length > 0}
				<div class="examples">
					{#each sense.examples as example, exampleIndex (exampleIndex)}
						<p class="example">"{example}"</p>
					{/each}
				</div>
			{/if}

			{#if sense.usages.length > 0}
				<div class="usages">
					{#each sense.usages as usage, usageIndex (usageIndex)}
						<p class="usage">{usage}</p>
					{/each}
				</div>
			{/if}
		</div>
	{/each}
{/if}

<style>
	.loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 2rem;
		color: var(--text-secondary);
		text-align: center;
	}

	.spinner {
		animation: spin 1s linear infinite;
		color: var(--accent);
	}

	@keyframes spin {
		from {
			transform: rotate(0deg);
		}
		to {
			transform: rotate(360deg);
		}
	}

	.error,
	.not-found {
		text-align: center;
		padding: 2rem;
		color: var(--text-secondary);
	}

	.error {
		color: var(--danger);
	}

	.suggestion {
		font-size: 0.875rem;
		margin-top: 0.5rem;
		opacity: 0.8;
	}

	.placeholder {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 2rem;
		color: var(--text-secondary);
		gap: 1rem;
	}

	.placeholder-icon {
		opacity: 0.5;
		color: var(--text-tertiary);
	}

	.placeholder p {
		margin: 0;
		line-height: 1.5;
	}

	.hint {
		font-size: 0.875rem;
		opacity: 0.7;
		font-style: italic;
	}

	.word-header {
		margin-bottom: 1.5rem;
	}

	.word-header h3 {
		margin: 0 0 0.5rem 0;
		font-size: 1.5rem;
		color: var(--text-primary);
		font-weight: 600;
	}

	.pronunciations {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-bottom: 0.5rem;
	}

	.pronunciation {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	/* Middot separator between adjacent pronunciations */
	.pronunciation + .pronunciation::before {
		content: '·';
		color: var(--text-tertiary);
		margin-right: 0.375rem;
	}

	.ipa {
		color: var(--text-secondary);
		font-family: var(--font-family-mono);
		font-size: 0.95rem;
	}

	.variety {
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 3px;
		padding: 0.05rem 0.3rem;
	}

	.variation-note {
		margin: 0 0 0.5rem 0;
		font-size: 0.85rem;
		color: var(--text-secondary);
		font-style: italic;
	}

	.word-stats {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.stat {
		font-size: 0.875rem;
		color: var(--text-secondary);
		background: var(--bg-secondary);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--border);
	}

	.sense {
		margin-bottom: 2rem;
		padding-bottom: 2rem;
		border-bottom: 1px solid var(--border);
	}

	.sense:last-child {
		border-bottom: none;
		margin-bottom: 0;
		padding-bottom: 0;
	}

	.sense-info {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}

	.sense-number {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: var(--accent);
		color: white;
		border-radius: 50%;
		font-size: 0.875rem;
		font-weight: 600;
	}

	.pos {
		background: var(--accent-bg);
		color: var(--accent);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.domain {
		background: var(--warning-bg);
		color: var(--warning);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.common {
		background: var(--success-bg);
		color: var(--success);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.definition {
		margin: 0.5rem 0;
		color: var(--text-primary);
		line-height: 1.5;
		font-size: 0.95rem;
	}

	.examples {
		margin: 1rem 0;
	}

	.example {
		margin: 0.5rem 0;
		color: var(--text-secondary);
		font-style: italic;
		padding-left: 1rem;
		border-left: 3px solid var(--border);
		line-height: 1.4;
		font-size: 0.9rem;
	}

	.usages {
		margin: 1rem 0;
	}

	.usage {
		margin: 0.5rem 0;
		padding: 0.4rem 0.6rem;
		color: var(--warning);
		background: var(--warning-bg);
		border-left: 3px dashed var(--warning);
		border-radius: 0 4px 4px 0;
		line-height: 1.4;
		font-size: 0.85rem;
	}
</style>
