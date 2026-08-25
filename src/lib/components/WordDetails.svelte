<script lang="ts">
	import { onMount } from 'svelte';
	import { selectedWordData, wordPanelOpen } from '../stores.js';
	import { clearSelection, selectWord } from '../word-lookup.js';
	import type { Pronunciation, RelationTarget, WordSense } from '../word-lookup.js';

	// Relation groups shown in this order; every other group follows alphabetically.
	const RELATION_PRIORITY = [
		'hypernym',
		'hyponym',
		'antonym',
		'similar',
		'collocation',
		'derivation'
	];

	// The API carries one pronunciation per part of speech; the header shows no part of
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

	// The store carries the raw JSON payload as `any`. These two casts are the only place
	// that boundary is crossed; everything the template reads below them is typed.
	$: pronunciations = dedupePronunciations(
		($selectedWordData.data?.pronunciations ?? []) as Pronunciation[]
	);
	$: senses = ($selectedWordData.data?.senses ?? []) as WordSense[];

	function exploreWord(word: string) {
		// Optional feature gate: never fetch while the panel is collapsed.
		if (!$wordPanelOpen) return;

		selectWord(word);
	}

	function orderRelations(
		relations: Record<string, RelationTarget[]> | undefined
	): [string, RelationTarget[]][] {
		// Input collection
		const entries = Object.entries(relations ?? {});
		const prioritised: [string, RelationTarget[]][] = [];
		const remaining: [string, RelationTarget[]][] = [];

		// Processing
		for (const entry of entries) {
			if (RELATION_PRIORITY.includes(entry[0])) {
				prioritised.push(entry);
			} else {
				remaining.push(entry);
			}
		}

		prioritised.sort((a, b) => RELATION_PRIORITY.indexOf(a[0]) - RELATION_PRIORITY.indexOf(b[0]));
		remaining.sort((a, b) => a[0].localeCompare(b[0]));

		// Output construction
		return [...prioritised, ...remaining];
	}

	// This component only mounts while the panel is open. On (re)mount after an
	// expand, refetch a currently-selected word that has no loaded data so the
	// panel isn't stale-empty (e.g. words picked while it was collapsed).
	onMount(() => {
		if ($selectedWordData.word && !$selectedWordData.data && !$selectedWordData.loading) {
			exploreWord($selectedWordData.word);
		}
	});
</script>

<div class="word-details-container">
	{#if $selectedWordData.word}
		<div class="selected-word-banner">
			<div class="selected-word-content">
				<span class="label">Selected Word:</span>
				<span class="word">{$selectedWordData.word}</span>
			</div>
			<button class="clear-btn" onclick={() => clearSelection()} title="Clear selection">
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
		</div>
	{/if}

	<div class="word-details-content">
		{#if $selectedWordData.loading}
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
		{:else if $selectedWordData.data}
			{#if $selectedWordData.data.error}
				<div class="error">
					<p>{$selectedWordData.data.message}</p>
				</div>
			{:else if !$selectedWordData.data.found}
				<div class="not-found">
					<p>Word "{$selectedWordData.data.word}" not found in WordNet</p>
					<p class="suggestion">Try searching for a different word or check the spelling.</p>
				</div>
			{:else}
				<div class="word-info">
					<div class="word-header">
						<h3>{$selectedWordData.data.display_word}</h3>
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
						{#if $selectedWordData.data.was_variation}
							<p class="variation-note">
								Showing <strong>{$selectedWordData.data.display_word}</strong> for "{$selectedWordData
									.data.searched_word}"
							</p>
						{/if}
						<div class="word-stats">
							<span class="stat"
								>{$selectedWordData.data.total_senses} sense{$selectedWordData.data.total_senses !==
								1
									? 's'
									: ''}</span
							>
							<span class="stat"
								>{$selectedWordData.data.stats.total_definitions} definition{$selectedWordData.data
									.stats.total_definitions !== 1
									? 's'
									: ''}</span
							>
							<span class="stat"
								>{$selectedWordData.data.stats.total_examples} example{$selectedWordData.data.stats
									.total_examples !== 1
									? 's'
									: ''}</span
							>
						</div>
					</div>

					<!-- Senses -->
					<div class="senses-container">
						{#each senses as sense, i (sense)}
							{@const relationGroups = orderRelations(sense.relations)}
							<div class="sense">
								<div class="sense-header">
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
								</div>

								<!-- Definition -->
								<div class="definitions">
									<p class="definition">{sense.definition}</p>
								</div>

								<!-- Examples -->
								{#if sense.examples.length > 0}
									<div class="examples">
										{#each sense.examples as example, exampleIndex (exampleIndex)}
											<p class="example">"{example}"</p>
										{/each}
									</div>
								{/if}

								<!-- Usage notes -->
								{#if sense.usages.length > 0}
									<div class="usages">
										{#each sense.usages as usage, usageIndex (usageIndex)}
											<p class="usage">{usage}</p>
										{/each}
									</div>
								{/if}

								<!-- Sense synonyms -->
								{#if sense.synonyms.length > 0}
									<div class="sense-synonyms">
										<span class="sense-synonyms-label">Synonyms</span>
										<div class="synonym-list">
											{#each sense.synonyms as synonym, synonymIndex (synonymIndex)}
												<button class="synonym-btn" onclick={() => exploreWord(synonym)}>
													{synonym}
												</button>
											{/each}
										</div>
									</div>
								{/if}

								<!-- Relations -->
								{#if relationGroups.length > 0}
									<div class="relationships">
										<h5 class="relationships-title">Related Words</h5>
										{#each relationGroups as [type, words] (type)}
											<div class="relationship-group">
												<div class="rel-type-header">
													<span class="rel-type"
														>{type.charAt(0).toUpperCase() + type.slice(1)}</span
													>
													<span class="rel-count">({words.length})</span>
												</div>
												<div class="rel-words-grid">
													{#each words as relatedWord (relatedWord)}
														<button
															class="related-word-item"
															onclick={() => exploreWord(relatedWord.word)}
															title="Click to explore: {relatedWord.word}"
														>
															<span class="word-text">{relatedWord.word}</span>
															<span class="word-pos">{relatedWord.pos}</span>
														</button>
													{/each}
												</div>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{/each}
					</div>

					<!-- Synonyms -->
					{#if $selectedWordData.data.synonyms && $selectedWordData.data.synonyms.length > 0}
						<div class="synonyms">
							<h4>Synonyms</h4>
							<div class="synonym-list">
								{#each $selectedWordData.data.synonyms as synonym, synonymIndex (synonymIndex)}
									<button class="synonym-btn" onclick={() => exploreWord(synonym)}>
										{synonym}
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/if}
		{:else}
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
		{/if}
	</div>
</div>

<style>
	.word-details-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}

	.selected-word-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		background: linear-gradient(135deg, var(--accent-bg) 0%, var(--bg-secondary) 100%);
		border-bottom: 2px solid var(--accent);
		margin-bottom: 1rem;
	}

	.selected-word-content {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.selected-word-banner .label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 500;
	}

	.selected-word-banner .word {
		font-size: 1.125rem;
		color: var(--accent);
		font-weight: 700;
		font-family: var(--font-family);
	}

	.clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: 1px solid var(--border);
		background: var(--bg-primary);
		color: var(--text-secondary);
		border-radius: 50%;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.clear-btn:hover {
		background: var(--danger-bg);
		color: var(--danger);
		border-color: var(--danger);
		transform: scale(1.1);
	}

	.word-details-content {
		flex: 1;
		padding: 1rem;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.word-details-content::-webkit-scrollbar {
		width: 8px;
	}

	.word-details-content::-webkit-scrollbar-track {
		background: transparent;
	}

	.word-details-content::-webkit-scrollbar-thumb {
		background: var(--border);
		border-radius: 4px;
	}

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
		height: 100%;
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

	.sense-header {
		margin-bottom: 1rem;
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

	.definitions {
		margin-bottom: 1rem;
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

	.sense-synonyms {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin: 1rem 0;
	}

	.sense-synonyms-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	.relationships {
		margin-top: 1.5rem;
		background: var(--bg-secondary);
		padding: 1rem;
		border-radius: 8px;
		border: 1px solid var(--border);
	}

	.relationships-title {
		margin: 0 0 1rem 0;
		font-size: 1rem;
		color: var(--text-primary);
		font-weight: 600;
	}

	.relationship-group {
		margin-bottom: 1.5rem;
	}

	.relationship-group:last-child {
		margin-bottom: 0;
	}

	.rel-type-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
	}

	.rel-type {
		font-weight: 600;
		color: var(--text-primary);
		font-size: 0.875rem;
		background: var(--bg-primary);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--border);
	}

	.rel-count {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.rel-words-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 0.5rem;
	}

	.related-word-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: left;
	}

	.related-word-item:hover {
		background: var(--bg-hover);
		border-color: var(--accent);
		transform: translateY(-1px);
	}

	.word-text {
		color: var(--accent);
		font-weight: 500;
		text-decoration: underline;
	}

	.word-pos {
		background: var(--accent-bg);
		color: var(--accent);
		padding: 0.125rem 0.375rem;
		border-radius: 3px;
		font-size: 0.75rem;
		font-weight: 500;
	}

	.synonyms {
		margin-top: 2rem;
		padding-top: 2rem;
		border-top: 1px solid var(--border);
	}

	.synonyms h4 {
		margin: 0 0 1rem 0;
		color: var(--text-primary);
		font-weight: 600;
	}

	.synonym-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.synonym-btn {
		padding: 0.375rem 0.75rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		color: var(--accent);
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.875rem;
		transition: all 0.2s ease;
		text-decoration: underline;
	}

	.synonym-btn:hover {
		background: var(--accent-bg);
		border-color: var(--accent);
	}
</style>
