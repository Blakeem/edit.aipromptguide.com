<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import {
		moveWordSection,
		openWordSections,
		sectionPickerOpen,
		selectedWord,
		setWordSectionHeight,
		toggleWordSection,
		wordPanelOpen,
		wordSectionHeights,
		wordSectionStates
	} from '../stores.js';
	import type { WordSectionStates } from '../stores.js';
	import { reorderTransform, startReorderDrag } from '../reorder-drag.js';
	import type { ReorderDrag, ReorderState } from '../reorder-drag.js';
	import { clearSelection } from '../word-lookup.js';
	import { buildSenseGroups, countGroupWords, SECTION_TITLES } from '../word-section-view.js';
	import { WORD_SECTION_IDS } from '../word-sections.js';
	import type { WordSectionId } from '../word-sections.js';
	import DictionaryPanel from './DictionaryPanel.svelte';
	import RelationPanel from './RelationPanel.svelte';

	interface PanelReorder {
		sectionId: WordSectionId;
		pointerId: number;
		controller: ReorderDrag;
		sectionOrder: string;
	}

	interface PanelResize {
		sectionId: WordSectionId;
		pointerId: number;
		startY: number;
		startHeight: number;
		maxHeight: number;
		height: number;
	}

	const MIN_PANEL_HEIGHT_PX = 96;
	const KEYBOARD_RESIZE_STEP_PX = 24;

	let stack: HTMLDivElement;
	let panelElements: Partial<Record<WordSectionId, HTMLElement>> = {};
	let reorder: PanelReorder | null = null;
	let reorderState: ReorderState | null = null;
	let resize: PanelResize | null = null;

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

	// A live resize wins over the stored height. No height means the panel sizes to its content.
	function panelHeight(
		sectionId: WordSectionId,
		heights: Partial<Record<WordSectionId, number>>,
		activeResize: PanelResize | null
	): string | null {
		const height = activeResize?.sectionId === sectionId ? activeResize.height : heights[sectionId];
		return height === undefined ? null : `${height}px`;
	}

	const clampHeight = (height: number, maxHeight: number) =>
		Math.min(Math.max(height, MIN_PANEL_HEIGHT_PX), Math.max(maxHeight, MIN_PANEL_HEIGHT_PX));

	// A panel shown, hidden, or moved mid-drag invalidates the measured slots. A hidden panel
	// also takes its pointer capture with it, so its drag would never receive pointerup.
	$: dropStaleDrags($openWordSections);

	function dropStaleDrags(sectionIds: WordSectionId[]) {
		if (reorder && sectionIds.join() !== reorder.sectionOrder) endReorder(false);
		if (resize && !sectionIds.includes(resize.sectionId)) resize = null;
	}

	// The edge scroll runs on requestAnimationFrame and would outlive the sidebar.
	onDestroy(() => endReorder(false));

	// A newly shown panel lands at the bottom of the stack, which may be scrolled out of view.
	async function handleChipClick(sectionId: WordSectionId) {
		const wasOpen = $openWordSections.includes(sectionId);

		toggleWordSection(sectionId);
		if (wasOpen) return;

		await tick();
		panelElements[sectionId]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	}

	function handleGripPointerDown(event: PointerEvent, sectionId: WordSectionId, index: number) {
		// Input collection
		const items = Array.from(stack.querySelectorAll<HTMLElement>('[data-panel-id]'));

		// Edge cases: secondary buttons, or another drag already running
		if (event.button !== 0 || reorder || resize) return;

		// Processing
		event.preventDefault();

		// Output construction
		reorder = {
			sectionId,
			pointerId: event.pointerId,
			controller: startReorderDrag({
				axis: 'y',
				container: stack,
				items,
				fromIndex: index,
				pointerId: event.pointerId,
				captureElement: event.currentTarget as HTMLElement,
				grabClientPosition: event.clientY,
				onChange: (state) => (reorderState = state)
			}),
			sectionOrder: $openWordSections.join()
		};
	}

	function handleGripPointerMove(event: PointerEvent) {
		if (!reorder || event.pointerId !== reorder.pointerId) return;
		reorder.controller.move(event.clientY);
	}

	function handleGripPointerEnd(event: PointerEvent) {
		if (!reorder || event.pointerId !== reorder.pointerId) return;
		endReorder(event.type === 'pointerup');
	}

	// lostpointercapture bubbles, and the icon's implicit touch capture is lost on purpose when
	// the drag captures the grip itself.
	function handleGripLostCapture(event: PointerEvent) {
		if (event.target === event.currentTarget) handleGripPointerEnd(event);
	}

	function endReorder(commit: boolean) {
		// Input collection
		const finishedReorder = reorder;
		let targetIndex: number | null = null;

		if (!finishedReorder) return;

		// Processing
		targetIndex = finishedReorder.controller.end(commit);

		// Output construction
		reorder = null;
		reorderState = null;
		if (targetIndex !== null) moveWordSection(finishedReorder.sectionId, targetIndex);
	}

	async function handleGripKeydown(event: KeyboardEvent, sectionId: WordSectionId, index: number) {
		// Input collection
		const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
		const targetIndex = index + step;

		if (step === 0 || reorder || resize) return;
		if (targetIndex < 0 || targetIndex >= $openWordSections.length) return;

		// Processing
		event.preventDefault();
		moveWordSection(sectionId, targetIndex);

		// Output construction: the keyed move can detach the focused grip, which drops focus
		// to the page and ends keyboard reordering after one step.
		await tick();
		panelElements[sectionId]?.querySelector<HTMLElement>('.grip')?.focus();
	}

	function handleResizePointerDown(event: PointerEvent, sectionId: WordSectionId) {
		// Input collection
		const panel = panelElements[sectionId];

		// Edge cases: secondary buttons, a missing panel, or another drag already running
		if (event.button !== 0 || !panel || reorder || resize) return;

		// Processing
		event.preventDefault();
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

		// Output construction
		resize = {
			sectionId,
			pointerId: event.pointerId,
			startY: event.clientY,
			startHeight: panel.offsetHeight,
			maxHeight: stack.clientHeight,
			height: panel.offsetHeight
		};
	}

	function handleResizePointerMove(event: PointerEvent) {
		if (!resize || event.pointerId !== resize.pointerId) return;
		resize.height = clampHeight(
			resize.startHeight + event.clientY - resize.startY,
			resize.maxHeight
		);
	}

	function handleResizePointerEnd(event: PointerEvent) {
		// Input collection
		const finishedResize = resize;

		if (!finishedResize || event.pointerId !== finishedResize.pointerId) return;

		// Output construction
		resize = null;
		if (event.type === 'pointerup') {
			setWordSectionHeight(finishedResize.sectionId, finishedResize.height);
		}
	}

	function handleResizeKeydown(event: KeyboardEvent, sectionId: WordSectionId) {
		// Input collection
		const panel = panelElements[sectionId];
		const step =
			event.key === 'ArrowUp'
				? -KEYBOARD_RESIZE_STEP_PX
				: event.key === 'ArrowDown'
					? KEYBOARD_RESIZE_STEP_PX
					: 0;

		if (step === 0 || !panel || reorder || resize) return;

		// Output construction
		event.preventDefault();
		setWordSectionHeight(sectionId, clampHeight(panel.offsetHeight + step, stack.clientHeight));
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
			class="sections-btn"
			class:active={$sectionPickerOpen}
			aria-expanded={$sectionPickerOpen}
			aria-controls="word-section-picker"
			onclick={() => sectionPickerOpen.update((open) => !open)}
			title="Choose which sections to show"
		>
			Sections
			<svg
				class="sections-chevron"
				width="12"
				height="12"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			>
				<polyline points="6 9 12 15 18 9" />
			</svg>
		</button>
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

	{#if $sectionPickerOpen}
		<div class="section-picker" id="word-section-picker">
			{#each WORD_SECTION_IDS as sectionId (sectionId)}
				{@const isShown = $openWordSections.includes(sectionId)}
				<button
					class="section-chip"
					class:shown={isShown}
					aria-pressed={isShown}
					onclick={() => handleChipClick(sectionId)}
				>
					{SECTION_TITLES[sectionId]}
				</button>
			{/each}
		</div>
	{/if}

	<div class="stack" class:reordering={reorder !== null} bind:this={stack}>
		{#each $openWordSections as sectionId, index (sectionId)}
			{@const count = panelCount(sectionId, $wordSectionStates)}
			{@const height = panelHeight(sectionId, $wordSectionHeights, resize)}
			<section
				class="panel"
				class:fit-content={height === null}
				class:held={reorder?.sectionId === sectionId}
				data-panel-id={sectionId}
				style:height
				style:transform={reorderTransform(index, reorderState)}
				bind:this={panelElements[sectionId]}
			>
				<div class="panel-header">
					<button
						class="grip"
						onpointerdown={(event) => handleGripPointerDown(event, sectionId, index)}
						onpointermove={handleGripPointerMove}
						onpointerup={handleGripPointerEnd}
						onpointercancel={handleGripPointerEnd}
						onlostpointercapture={handleGripLostCapture}
						onkeydown={(event) => handleGripKeydown(event, sectionId, index)}
						title="Drag to reorder"
						aria-label="Reorder {SECTION_TITLES[sectionId]}"
					>
						<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor">
							<circle cx="3" cy="3" r="1.5" />
							<circle cx="9" cy="3" r="1.5" />
							<circle cx="3" cy="8" r="1.5" />
							<circle cx="9" cy="8" r="1.5" />
							<circle cx="3" cy="13" r="1.5" />
							<circle cx="9" cy="13" r="1.5" />
						</svg>
					</button>
					<span class="panel-title">{SECTION_TITLES[sectionId]}</span>
					{#if count !== null}
						<span class="panel-count" class:empty={count === 0}>{count}</span>
					{/if}
					<button
						class="hide-btn"
						onclick={() => toggleWordSection(sectionId)}
						title="Hide section"
						aria-label="Hide {SECTION_TITLES[sectionId]}"
					>
						<svg
							width="12"
							height="12"
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

				<div class="panel-body">
					{#if sectionId === 'dictionary'}
						<DictionaryPanel />
					{:else}
						<RelationPanel {sectionId} />
					{/if}
				</div>

				<button
					class="resize-handle"
					onpointerdown={(event) => handleResizePointerDown(event, sectionId)}
					onpointermove={handleResizePointerMove}
					onpointerup={handleResizePointerEnd}
					onpointercancel={handleResizePointerEnd}
					onlostpointercapture={handleResizePointerEnd}
					ondblclick={() => setWordSectionHeight(sectionId, null)}
					onkeydown={(event) => handleResizeKeydown(event, sectionId)}
					title="Drag to resize. Double-click to fit the content."
					aria-label="Resize {SECTION_TITLES[sectionId]}"
				></button>
			</section>
		{/each}
	</div>
</div>

<style>
	.word-sidebar {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--bg-secondary);
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

	.sections-btn {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 0.25rem;
		height: 28px;
		margin-left: auto;
		padding: 0 0.625rem;
		border: 1px solid var(--border);
		border-radius: 6px;
		background: var(--bg-primary);
		color: var(--text-secondary);
		font-size: 0.8rem;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.sections-btn:hover,
	.sections-btn.active {
		color: var(--accent);
		border-color: var(--accent);
	}

	.sections-chevron {
		transition: transform 0.15s ease;
	}

	.sections-btn.active .sections-chevron {
		transform: rotate(180deg);
	}

	.collapse-btn {
		border-radius: 6px;
	}

	.collapse-btn:hover {
		background: var(--bg-hover);
		color: var(--accent);
		border-color: var(--accent);
	}

	.section-picker {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		gap: 0.375rem;
		padding: 0.625rem 0.75rem;
		background: var(--bg-primary);
		border-bottom: 1px solid var(--border-strong);
	}

	.section-chip {
		padding: 0.25rem 0.625rem;
		border: 1px solid var(--border-strong);
		border-radius: 999px;
		background: var(--bg-primary);
		color: var(--text-secondary);
		font-size: 0.8rem;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.section-chip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}

	.section-chip.shown {
		background: var(--accent-bg);
		border-color: var(--accent);
		color: var(--accent);
		font-weight: 600;
	}

	/* The stack scrolls as a whole, so every panel keeps its height. Size containment lets
	   content-sized panels cap at half the stack, which fits two on screen. */
	.stack {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 0.75rem;
		min-height: 0;
		padding: 0.75rem;
		overflow-y: auto;
		container-type: size;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.panel {
		display: flex;
		flex: none;
		flex-direction: column;
		position: relative;
		min-height: 96px;
		background: var(--bg-primary);
		border: 1px solid var(--border-strong);
		border-radius: 8px;
		overflow: hidden;
	}

	.panel.fit-content {
		max-height: calc(50cqh - 0.375rem);
	}

	/* Only the panels sliding aside animate. The held panel tracks the pointer, and the drop
	   must snap because the reorder and the transform reset land in the same frame. */
	.stack.reordering .panel:not(.held) {
		transition: transform 0.15s ease;
	}

	.panel.held {
		z-index: 2;
		border-color: var(--accent);
		box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
	}

	.panel-header {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem 0.5rem 0.375rem;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border-strong);
		color: var(--text-primary);
		font-size: 0.9rem;
		font-weight: 600;
	}

	.grip {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 24px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-tertiary);
		cursor: grab;
		touch-action: none;
	}

	.grip:hover {
		background: var(--bg-hover);
		color: var(--text-secondary);
	}

	.panel.held .grip {
		cursor: grabbing;
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

	.hide-btn {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		cursor: pointer;
	}

	.hide-btn:hover {
		background: var(--bg-hover);
		color: var(--text-primary);
	}

	.panel-body {
		flex: 1 1 auto;
		min-height: 0;
		padding: 1rem;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--border) transparent;
	}

	.resize-handle {
		flex: none;
		height: 10px;
		padding: 0;
		border: none;
		border-top: 1px solid var(--border);
		background: var(--bg-secondary);
		cursor: ns-resize;
		touch-action: none;
	}

	.resize-handle::after {
		content: '';
		display: block;
		width: 32px;
		height: 3px;
		margin: 0 auto;
		border-radius: 2px;
		background: var(--border-strong);
	}

	.resize-handle:hover,
	.resize-handle:focus-visible {
		background: var(--accent-bg);
	}

	.resize-handle:hover::after,
	.resize-handle:focus-visible::after {
		background: var(--accent);
	}
</style>
