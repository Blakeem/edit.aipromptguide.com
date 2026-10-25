<script lang="ts">
	import { replaceEditorWord } from '../stores.js';
	import { selectWord } from '../word-lookup.js';

	export let word: string;
	export let pos: string | null = null;
	export let title: string | null = null;
	// The editor word a click on the replace button swaps out. The panel computes it once for
	// all its chips, so chips hold no store subscriptions of their own.
	export let replaceTarget: string | null = null;

	// Swapping a word for itself changes nothing.
	$: canReplace = replaceTarget !== null && replaceTarget.toLowerCase() !== word.toLowerCase();
</script>

<span class="word-chip">
	<button class="explore-btn" onclick={() => selectWord(word)} title={title ?? `Look up ${word}`}>
		<span class="chip-word">{word}</span>
		{#if pos}
			<span class="chip-pos">{pos}</span>
		{/if}
	</button>
	{#if canReplace}
		<button
			class="replace-btn"
			onclick={() => replaceEditorWord(word)}
			title="Replace “{replaceTarget}” with “{word}”"
			aria-label="Replace “{replaceTarget}” with “{word}”"
		>
			<svg
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="17 1 21 5 17 9" />
				<path d="M3 11V9a4 4 0 0 1 4-4h14" />
				<polyline points="7 23 3 19 7 15" />
				<path d="M21 13v2a4 4 0 0 1-4 4H3" />
			</svg>
		</button>
	{/if}
</span>

<style>
	.word-chip {
		display: inline-flex;
		align-items: stretch;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-secondary);
		overflow: hidden;
		transition: border-color 0.2s ease;
	}

	.word-chip:hover,
	.word-chip:focus-within {
		border-color: var(--accent);
	}

	.explore-btn,
	.replace-btn {
		display: inline-flex;
		align-items: center;
		border: none;
		background: transparent;
		color: var(--accent);
		cursor: pointer;
		font-size: 0.875rem;
		transition: background 0.2s ease;
	}

	.explore-btn {
		gap: 0.375rem;
		padding: 0.25rem 0.625rem;
	}

	.explore-btn:hover,
	.replace-btn:hover {
		background: var(--accent-bg);
	}

	.chip-word {
		text-decoration: underline;
	}

	.chip-pos {
		color: var(--text-secondary);
		font-size: 0.7rem;
	}

	/* Always shown: revealing it on hover would widen the chip and reflow the list
	   under the pointer. */
	.replace-btn {
		padding: 0 0.375rem;
		border-left: 1px solid var(--border);
		color: var(--text-tertiary);
	}

	.replace-btn:hover {
		color: var(--accent);
	}
</style>
