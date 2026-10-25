<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { tabs, activeTabId, createNewTab, closeTab, moveTab, renameTab } from '../stores.js';
	import type { Tab } from '../stores.js';
	import { reorderTransform, startReorderDrag } from '../reorder-drag.js';
	import type { ReorderDrag, ReorderState } from '../reorder-drag.js';

	interface TabDrag {
		tabId: string;
		pointerId: number;
		controller: ReorderDrag;
		tabOrder: string;
	}

	interface TabPress {
		tabId: string;
		pointerId: number;
		element: HTMLElement;
		startX: number;
		startY: number;
		timer: ReturnType<typeof setTimeout>;
	}

	const LONG_PRESS_MS = 350;
	const PRESS_MOVE_TOLERANCE_PX = 6;

	let editingTabId: string | null = null;
	let editingName = '';
	let confirmCloseTabId: string | null = null;

	// Tab strip overflow scrolling
	let tabsContainer: HTMLDivElement;
	let canScrollLeft = false;
	let canScrollRight = false;
	let resizeObserver: ResizeObserver | null = null;

	// Tab drag reordering
	let press: TabPress | null = null;
	let drag: TabDrag | null = null;
	let dragState: ReorderState | null = null;

	// Overflow exists when the strip can scroll in either direction
	$: hasOverflow = canScrollLeft || canScrollRight;

	function updateScrollButtons() {
		if (!tabsContainer) return;
		const { scrollLeft, scrollWidth, clientWidth } = tabsContainer;
		canScrollLeft = scrollLeft > 0;
		// 1px tolerance for sub-pixel rounding at the far edge
		canScrollRight = Math.ceil(scrollLeft + clientWidth) < scrollWidth;
	}

	function scrollTabs(direction: number) {
		if (!tabsContainer) return;
		tabsContainer.scrollBy({
			left: direction * Math.round(tabsContainer.clientWidth * 0.75),
			behavior: 'smooth'
		});
	}

	function handleNewTab() {
		createNewTab();
		// Reveal the freshly created tab at the end of the strip
		tick().then(() => {
			if (tabsContainer) {
				tabsContainer.scrollTo({ left: tabsContainer.scrollWidth, behavior: 'smooth' });
			}
			updateScrollButtons();
		});
	}

	// Recompute overflow state whenever the tab set changes (after the DOM updates)
	$: if ($tabs) {
		tick().then(updateScrollButtons);
	}

	// A tab opened, closed, or moved mid-drag invalidates the measured slots. A closed tab also
	// takes its pointer capture with it, so its drag would never receive pointerup.
	$: dropStaleDrag($tabs);

	const tabOrderOf = (currentTabs: Tab[]) => currentTabs.map((tab) => tab.id).join();

	function dropStaleDrag(currentTabs: Tab[]) {
		if (drag && tabOrderOf(currentTabs) !== drag.tabOrder) endDrag(false);
	}

	onMount(() => {
		updateScrollButtons();
		resizeObserver = new ResizeObserver(() => updateScrollButtons());
		resizeObserver.observe(tabsContainer);
		// Svelte registers ontouchmove as passive, and only a non-passive listener can stop
		// a touch drag from panning the strip.
		tabsContainer.addEventListener('touchmove', blockTouchPanWhileDragging, { passive: false });
		return () => {
			resizeObserver?.disconnect();
			resizeObserver = null;
			tabsContainer.removeEventListener('touchmove', blockTouchPanWhileDragging);
			cancelPress();
			endDrag(false);
		};
	});

	function blockTouchPanWhileDragging(event: TouchEvent) {
		if (drag) event.preventDefault();
	}

	function handleTabPointerDown(event: PointerEvent, tab: Tab) {
		// Input collection
		const element = event.currentTarget as HTMLElement;
		const onCloseButton = (event.target as HTMLElement).closest('.close-btn') !== null;

		// Edge cases: secondary buttons, the close button, and the rename input keep their
		// own behavior
		if (event.button !== 0 || onCloseButton || editingTabId === tab.id || drag) return;

		// Processing
		cancelPress();
		press = {
			tabId: tab.id,
			pointerId: event.pointerId,
			element,
			startX: event.clientX,
			startY: event.clientY,
			timer: setTimeout(beginDrag, LONG_PRESS_MS)
		};
	}

	function cancelPress() {
		if (!press) return;
		clearTimeout(press.timer);
		press = null;
	}

	function beginDrag() {
		// Input collection
		const currentPress = press;
		const tabElements = Array.from(tabsContainer.querySelectorAll<HTMLElement>('[data-tab-id]'));
		let fromIndex = -1;

		// Edge case: the press was cancelled between the timer firing and this call
		if (!currentPress) return;
		press = null;

		// Processing
		fromIndex = tabElements.indexOf(currentPress.element);
		if (fromIndex === -1) return;

		// Output construction
		drag = {
			tabId: currentPress.tabId,
			pointerId: currentPress.pointerId,
			controller: startReorderDrag({
				axis: 'x',
				container: tabsContainer,
				items: tabElements,
				fromIndex,
				pointerId: currentPress.pointerId,
				captureElement: currentPress.element,
				grabClientPosition: currentPress.startX,
				onChange: (state) => (dragState = state)
			}),
			tabOrder: tabOrderOf($tabs)
		};
		$activeTabId = currentPress.tabId;
	}

	function handleTabPointerMove(event: PointerEvent) {
		// Input collection
		let distance = 0;

		// Processing: a press that moves before the long press fires is a click or a pan
		if (press && event.pointerId === press.pointerId) {
			distance = Math.hypot(event.clientX - press.startX, event.clientY - press.startY);
			if (distance > PRESS_MOVE_TOLERANCE_PX) cancelPress();
			return;
		}

		if (!drag || event.pointerId !== drag.pointerId) return;
		drag.controller.move(event.clientX);
	}

	function endDrag(commit: boolean) {
		// Input collection
		const finishedDrag = drag;
		let targetIndex: number | null = null;

		if (!finishedDrag) return;

		// Processing
		targetIndex = finishedDrag.controller.end(commit);

		// Output construction
		drag = null;
		dragState = null;
		if (targetIndex !== null) moveTab(finishedDrag.tabId, targetIndex);
	}

	// A mouse released outside the tab sends it no pointerup, so the long press would later
	// start a drag with no button held. Touch keeps an implicit capture and never leaves early.
	function handleTabPointerLeave(event: PointerEvent) {
		if (press && event.pointerId === press.pointerId) cancelPress();
	}

	function handleTabPointerEnd(event: PointerEvent) {
		cancelPress();
		if (drag && event.pointerId === drag.pointerId) endDrag(event.type === 'pointerup');
	}

	// lostpointercapture bubbles, and a child's implicit touch capture is lost on purpose when
	// the drag captures the tab itself.
	function handleTabLostCapture(event: PointerEvent) {
		if (event.target === event.currentTarget) handleTabPointerEnd(event);
	}

	// The native tooltip carries the full name only when CSS cut it off with an ellipsis.
	function showFullNameIfTruncated(element: HTMLElement, name: string) {
		element.title = element.scrollWidth > element.clientWidth ? name : '';
	}

	function startEditing(tab: Tab) {
		editingTabId = tab.id;
		editingName = tab.name;
	}

	function finishEditing() {
		if (editingTabId && editingName.trim()) {
			renameTab(editingTabId, editingName.trim());
		}
		editingTabId = null;
		editingName = '';
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			finishEditing();
		} else if (event.key === 'Escape') {
			editingTabId = null;
			editingName = '';
		}
	}

	function handleTabClose(event: Event, tabId: string) {
		event.stopPropagation();
		const tab = $tabs.find((t) => t.id === tabId);
		if (tab && tab.content.trim().length > 0) {
			confirmCloseTabId = tabId;
		} else {
			closeTab(tabId);
		}
	}

	function confirmClose() {
		if (confirmCloseTabId) {
			closeTab(confirmCloseTabId);
			confirmCloseTabId = null;
		}
	}

	function cancelClose() {
		confirmCloseTabId = null;
	}
</script>

<div class="tab-bar">
	{#if hasOverflow}
		<button
			class="scroll-arrow"
			onclick={() => scrollTabs(-1)}
			disabled={!canScrollLeft}
			title="Scroll tabs left"
			aria-label="Scroll tabs left"
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
		</button>
	{/if}
	<div
		class="tabs-container"
		class:dragging={drag !== null}
		bind:this={tabsContainer}
		onscroll={updateScrollButtons}
	>
		{#each $tabs as tab, index (tab.id)}
			<div
				class="tab"
				class:active={$activeTabId === tab.id}
				class:dragging={drag?.tabId === tab.id}
				data-tab-id={tab.id}
				style:transform={reorderTransform(index, dragState)}
				onclick={() => ($activeTabId = tab.id)}
				onpointerdown={(event) => handleTabPointerDown(event, tab)}
				onpointermove={handleTabPointerMove}
				onpointerup={handleTabPointerEnd}
				onpointercancel={handleTabPointerEnd}
				onpointerleave={handleTabPointerLeave}
				onlostpointercapture={handleTabLostCapture}
				oncontextmenu={(event) => {
					if (press || drag) event.preventDefault();
				}}
			>
				{#if editingTabId === tab.id}
					<input
						type="text"
						bind:value={editingName}
						onkeydown={handleKeydown}
						onblur={finishEditing}
						class="tab-name-input"
						autofocus
					/>
				{:else}
					<span
						class="tab-name"
						ondblclick={() => startEditing(tab)}
						onmouseenter={(event) => showFullNameIfTruncated(event.currentTarget, tab.name)}
					>
						{tab.name}
					</span>
				{/if}

				{#if $tabs.length > 1}
					<button class="close-btn" onclick={(e) => handleTabClose(e, tab.id)} title="Close tab">
						×
					</button>
				{/if}
			</div>
		{/each}

		<button class="new-tab-btn" onclick={handleNewTab} title="New tab"> + </button>
	</div>
	{#if hasOverflow}
		<button
			class="scroll-arrow"
			onclick={() => scrollTabs(1)}
			disabled={!canScrollRight}
			title="Scroll tabs right"
			aria-label="Scroll tabs right"
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
	{/if}
</div>

{#if confirmCloseTabId}
	<div class="modal-overlay" onclick={cancelClose}>
		<div class="modal" onclick={(e) => e.stopPropagation()}>
			<div class="modal-header">Close Document?</div>
			<div class="modal-body">This document has content. Are you sure you want to close it?</div>
			<div class="modal-actions">
				<button class="btn btn-cancel" onclick={cancelClose}>Cancel</button>
				<button class="btn btn-confirm" onclick={confirmClose}>Close</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.tab-bar {
		display: flex;
		align-items: center;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		padding: 0 1rem;
		min-height: 48px;
		gap: 0.5rem;
	}

	.tabs-container {
		display: flex;
		align-items: center;
		gap: 2px;
		flex: 1;
		overflow-x: auto;
		scrollbar-width: none;
		-ms-overflow-style: none;
	}

	.tabs-container::-webkit-scrollbar {
		display: none;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-bottom: none;
		border-radius: 8px 8px 0 0;
		cursor: pointer;
		white-space: nowrap;
		min-width: 120px;
		max-width: 200px;
		position: relative;
		user-select: none;
		touch-action: pan-x;
		transition:
			background 0.2s ease,
			border-color 0.2s ease;
	}

	/* Only the tabs sliding aside animate. The held tab tracks the pointer, and the drop
	   must snap because the reorder and the transform reset land in the same frame. */
	.tabs-container.dragging .tab:not(.dragging) {
		transition: transform 0.15s ease;
	}

	.tabs-container.dragging {
		cursor: grabbing;
	}

	.tab:hover {
		background: var(--bg-hover);
	}

	.tab.active {
		background: var(--bg-primary);
		border-color: var(--accent);
		border-bottom: 1px solid var(--bg-primary);
		margin-bottom: -1px;
		z-index: 1;
	}

	/* Follows .tab.active because the held tab is always the active tab. */
	.tab.dragging {
		z-index: 2;
		cursor: grabbing;
		background: var(--accent-bg);
		border-color: var(--accent);
	}

	.tab-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-primary);
		font-size: 0.875rem;
	}

	.tab-name-input {
		flex: 1;
		min-width: 0;
		user-select: text;
		background: transparent;
		border: 1px solid var(--accent);
		border-radius: 4px;
		padding: 2px 6px;
		font-size: 0.875rem;
		color: var(--text-primary);
		outline: none;
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border: none;
		background: transparent;
		color: var(--text-secondary);
		border-radius: 3px;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		transition: all 0.2s ease;
	}

	.close-btn:hover {
		background: var(--danger);
		color: white;
	}

	.new-tab-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: 1px solid var(--border);
		background: var(--bg-primary);
		color: var(--text-secondary);
		border-radius: 6px;
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
		transition: all 0.2s ease;
	}

	.new-tab-btn:hover {
		background: var(--bg-hover);
		color: var(--accent);
		border-color: var(--accent);
	}

	.scroll-arrow {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		border: 1px solid var(--border);
		background: var(--bg-primary);
		color: var(--text-secondary);
		border-radius: 6px;
		cursor: pointer;
		line-height: 1;
		transition: all 0.2s ease;
	}

	.scroll-arrow:hover:not(:disabled) {
		background: var(--bg-hover);
		color: var(--accent);
		border-color: var(--accent);
	}

	.scroll-arrow:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.modal {
		background: var(--bg-primary);
		border: 1px solid var(--border);
		border-radius: 8px;
		padding: 1.5rem;
		min-width: 300px;
		max-width: 400px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
	}

	.modal-header {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
		margin-bottom: 0.75rem;
	}

	.modal-body {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin-bottom: 1.25rem;
		line-height: 1.5;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
	}

	.btn {
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.875rem;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.btn-cancel {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		color: var(--text-primary);
	}

	.btn-cancel:hover {
		background: var(--bg-hover);
	}

	.btn-confirm {
		background: var(--danger);
		border: 1px solid var(--danger);
		color: white;
	}

	.btn-confirm:hover {
		background: var(--danger-bg);
		border-color: var(--danger);
		color: var(--danger);
	}
</style>
