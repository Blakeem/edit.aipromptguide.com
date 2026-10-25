<script lang="ts">
	import { tick } from 'svelte';
	import { activeTab, editorWordRange, updateTabContent, wordPanelOpen } from '../stores.js';
	import { selectWord } from '../word-lookup.js';

	let textareaElement: HTMLTextAreaElement;
	let lastPlacedTabId: string | null = null;

	// Handle word selection
	function handleTextClick(event: MouseEvent) {
		if (!$activeTab) return;
		// Word definitions are an optional feature: when the panel is collapsed,
		// never mutate selection state or fetch. Covers click + keyboard nav
		// (handleKeyDown delegates here).
		if (!$wordPanelOpen) return;

		const textarea = event.target as HTMLTextAreaElement;
		const position = textarea.selectionStart;

		// Find word boundaries
		let start = position;
		let end = position;

		// Move start to beginning of word
		while (start > 0 && /\w/.test($activeTab.content[start - 1])) {
			start--;
		}

		// Move end to end of word
		while (end < $activeTab.content.length && /\w/.test($activeTab.content[end])) {
			end++;
		}

		// Extract the word
		const word = $activeTab.content.slice(start, end).trim();

		// Recorded even when the word is already selected, since a second occurrence of it is
		// a new replacement target.
		$editorWordRange = word ? { tabId: $activeTab.id, start, end, word } : null;

		if (word) selectWord(word);
	}

	// Handle keyboard navigation for word selection
	function handleKeyDown(event: KeyboardEvent) {
		if (!$activeTab) return;

		if (event.ctrlKey || event.metaKey) {
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				event.preventDefault();
				const textarea = event.target as HTMLTextAreaElement;
				const position = textarea.selectionStart;

				let newPosition = position;

				if (event.key === 'ArrowLeft') {
					// Move to previous word
					newPosition--;
					while (newPosition > 0 && !/\w/.test($activeTab.content[newPosition])) {
						newPosition--;
					}
					while (newPosition > 0 && /\w/.test($activeTab.content[newPosition - 1])) {
						newPosition--;
					}
				} else {
					// Move to next word
					while (
						newPosition < $activeTab.content.length &&
						/\w/.test($activeTab.content[newPosition])
					) {
						newPosition++;
					}
					while (
						newPosition < $activeTab.content.length &&
						!/\w/.test($activeTab.content[newPosition])
					) {
						newPosition++;
					}
				}

				// ArrowLeft decrements unconditionally, so position 0 yields -1; setSelectionRange
				// would coerce that to an unsigned value and clamp it to the end of the text.
				if (newPosition < 0) newPosition = 0;

				textarea.setSelectionRange(newPosition, newPosition);
				handleTextClick({ target: textarea } as unknown as MouseEvent);
			}
		}
	}

	// Handle content changes
	function handleInput(event: Event) {
		if (!$activeTab) return;

		const textarea = event.target as HTMLTextAreaElement;
		$editorWordRange = null;
		updateTabContent($activeTab.id, textarea.value);
	}

	// Put the caret after the last character of the tab that is now showing.
	async function placeCursorAtEnd() {
		let end = 0;

		// The textarea is bound one-way to $activeTab.content, so the swapped-in
		// text only exists in the DOM after the pending update flushes.
		await tick();

		if (!textareaElement) return;

		end = textareaElement.value.length;

		textareaElement.setSelectionRange(end, end);
		textareaElement.focus();
		// scrollTop/scrollHeight are DOM properties of a bind:this node, not reactive state,
		// so writing one here cannot re-run this block.
		// eslint-disable-next-line svelte/infinite-reactive-loop
		textareaElement.scrollTop = textareaElement.scrollHeight;
	}

	// Keyed on tab identity, not on content: TextEditor is a single non-keyed
	// instance, so switching tabs replaces the value in place instead of
	// remounting, and typing must leave the caret where the user put it.
	// lastPlacedTabId is claimed synchronously so a content update landing
	// before tick() resolves cannot schedule a second placement.
	$: if ($activeTab && textareaElement && $activeTab.id !== lastPlacedTabId) {
		lastPlacedTabId = $activeTab.id;
		// The id claim above is the loop guard the rule cannot see: a re-run for the same
		// tab fails the condition, so this call reaches a fixed point after one placement.
		// eslint-disable-next-line svelte/infinite-reactive-loop
		placeCursorAtEnd();
	}
</script>

<div class="editor-container">
	<textarea
		bind:this={textareaElement}
		value={$activeTab.content}
		oninput={handleInput}
		onclick={handleTextClick}
		onkeydown={handleKeyDown}
		class="editor-textarea"
		placeholder="Start typing..."
		spellcheck="true"></textarea>

	<div class="editor-footer">
		<div class="editor-stats">
			<span>{$activeTab.wordCount} words</span>
			<span>•</span>
			<span>{$activeTab.characterCount} characters</span>
			<span>•</span>
			<span>Last modified: {$activeTab.lastModified.toLocaleTimeString()}</span>
		</div>

		<div class="editor-hints">
			<span class="hint">💡 Click words to explore definitions • Ctrl+Arrow to navigate</span>
		</div>
	</div>
</div>

<style>
	.editor-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}

	.editor-textarea {
		flex: 1;
		padding: 1.5rem;
		border: none;
		background: transparent;
		color: var(--text-primary);
		font-size: 1rem;
		line-height: 1.6;
		resize: none;
		font-family: 'Georgia', 'Times New Roman', serif;
		outline: none;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.editor-textarea::-webkit-scrollbar {
		width: 8px;
	}

	.editor-textarea::-webkit-scrollbar-track {
		background: transparent;
	}

	.editor-textarea::-webkit-scrollbar-thumb {
		background: var(--border);
		border-radius: 4px;
	}

	.editor-textarea::-webkit-scrollbar-thumb:hover {
		background: var(--text-secondary);
	}

	.editor-textarea::placeholder {
		color: var(--text-tertiary);
		font-style: italic;
	}

	.editor-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		background: var(--bg-secondary);
		border-top: 1px solid var(--border);
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.editor-stats {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.editor-hints {
		opacity: 0.7;
	}

	.hint {
		font-style: italic;
	}

	@media (max-width: 768px) {
		.editor-footer {
			flex-direction: column;
			gap: 0.5rem;
			align-items: flex-start;
		}

		.editor-hints {
			align-self: stretch;
		}
	}
</style>
