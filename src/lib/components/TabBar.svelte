<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { tabs, activeTabId, createNewTab, closeTab, moveTab, renameTab } from '../stores.js';
	import type { Tab } from '../stores.js';

	// Positions are in strip content coordinates (scrollLeft included), so they stay valid
	// while the strip scrolls under a held tab.
	interface TabDrag {
		tabId: string;
		pointerId: number;
		element: HTMLElement;
		fromIndex: number;
		targetIndex: number;
		originLeft: number;
		width: number;
		grabOffset: number;
		maxLeft: number;
		slotShift: number;
		otherCenters: number[];
		pointerClientX: number;
		offsetX: number;
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
	const EDGE_SCROLL_ZONE_PX = 48;
	const EDGE_SCROLL_MAX_STEP_PX = 14;

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
	let edgeScrollFrame: number | null = null;

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

	function toContentX(clientX: number): number {
		return clientX - tabsContainer.getBoundingClientRect().left + tabsContainer.scrollLeft;
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
		const gap = parseFloat(getComputedStyle(tabsContainer).columnGap) || 0;
		let fromIndex = -1;
		let originLeft = 0;
		let width = 0;
		let lastTabRight = 0;
		const otherCenters: number[] = [];

		// Edge case: the press was cancelled between the timer firing and this call
		if (!currentPress) return;
		press = null;

		// Processing
		fromIndex = tabElements.indexOf(currentPress.element);
		if (fromIndex === -1) return;

		for (const [index, tabElement] of tabElements.entries()) {
			const left = toContentX(tabElement.getBoundingClientRect().left);

			if (index === fromIndex) {
				originLeft = left;
				width = tabElement.offsetWidth;
			} else {
				otherCenters.push(left + tabElement.offsetWidth / 2);
			}
			lastTabRight = left + tabElement.offsetWidth;
		}

		currentPress.element.setPointerCapture(currentPress.pointerId);

		// Output construction
		drag = {
			tabId: currentPress.tabId,
			pointerId: currentPress.pointerId,
			element: currentPress.element,
			fromIndex,
			targetIndex: fromIndex,
			originLeft,
			width,
			grabOffset: toContentX(currentPress.startX) - originLeft,
			maxLeft: lastTabRight - width,
			slotShift: width + gap,
			otherCenters,
			pointerClientX: currentPress.startX,
			offsetX: 0
		};
		$activeTabId = currentPress.tabId;
		edgeScrollFrame = requestAnimationFrame(edgeScrollStep);
	}

	function updateDragPosition() {
		// Input collection
		let pointerLeft = 0;
		let shownLeft = 0;
		let center = 0;

		if (!drag) return;

		// Processing: only the drawn tab is clamped to the span the tabs occupy. The slot
		// uses the unclamped position, since a clamped center can never pass an end tab of
		// equal width.
		pointerLeft = toContentX(drag.pointerClientX) - drag.grabOffset;
		shownLeft = Math.min(Math.max(pointerLeft, 0), drag.maxLeft);
		center = pointerLeft + drag.width / 2;

		// Output construction
		drag.offsetX = shownLeft - drag.originLeft;
		drag.targetIndex = drag.otherCenters.filter((otherCenter) => otherCenter < center).length;
	}

	// Holding the tab near or past either strip edge scrolls the strip, faster the further out.
	function edgeScrollStep() {
		// Input collection
		const rect = tabsContainer.getBoundingClientRect();
		let depth = 0;

		if (!drag) return;

		// Processing
		if (drag.pointerClientX < rect.left + EDGE_SCROLL_ZONE_PX) {
			depth = drag.pointerClientX - (rect.left + EDGE_SCROLL_ZONE_PX);
		} else if (drag.pointerClientX > rect.right - EDGE_SCROLL_ZONE_PX) {
			depth = drag.pointerClientX - (rect.right - EDGE_SCROLL_ZONE_PX);
		}

		if (depth !== 0) {
			tabsContainer.scrollLeft +=
				Math.sign(depth) *
				EDGE_SCROLL_MAX_STEP_PX *
				Math.min(1, Math.abs(depth) / EDGE_SCROLL_ZONE_PX);
			updateDragPosition();
		}

		// Output construction
		edgeScrollFrame = requestAnimationFrame(edgeScrollStep);
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
		drag.pointerClientX = event.clientX;
		updateDragPosition();
	}

	function endDrag(commit: boolean) {
		// Input collection
		const finishedDrag = drag;

		if (!finishedDrag) return;

		// Processing
		if (edgeScrollFrame !== null) cancelAnimationFrame(edgeScrollFrame);
		edgeScrollFrame = null;
		if (finishedDrag.element.hasPointerCapture(finishedDrag.pointerId)) {
			finishedDrag.element.releasePointerCapture(finishedDrag.pointerId);
		}

		// Output construction
		drag = null;
		if (commit) moveTab(finishedDrag.tabId, finishedDrag.targetIndex);
	}

	function handleTabPointerEnd(event: PointerEvent) {
		cancelPress();
		if (drag && event.pointerId === drag.pointerId) endDrag(event.type === 'pointerup');
	}

	// The held tab follows the pointer. Tabs between its origin and target slide one slot
	// toward the origin to open the gap where it will land.
	function dragTransform(tabId: string, index: number, currentDrag: TabDrag | null): string {
		if (!currentDrag) return '';
		if (tabId === currentDrag.tabId) return `translateX(${currentDrag.offsetX}px)`;
		if (currentDrag.fromIndex < index && index <= currentDrag.targetIndex) {
			return `translateX(${-currentDrag.slotShift}px)`;
		}
		if (currentDrag.targetIndex <= index && index < currentDrag.fromIndex) {
			return `translateX(${currentDrag.slotShift}px)`;
		}
		return '';
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
				style:transform={dragTransform(tab.id, index, drag)}
				onclick={() => ($activeTabId = tab.id)}
				onpointerdown={(event) => handleTabPointerDown(event, tab)}
				onpointermove={handleTabPointerMove}
				onpointerup={handleTabPointerEnd}
				onpointercancel={handleTabPointerEnd}
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
