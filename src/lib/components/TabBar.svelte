<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { tabs, activeTabId, createNewTab, closeTab, renameTab } from '../stores.js';
	import type { Tab } from '../stores.js';

	let editingTabId: string | null = null;
	let editingName = '';
	let confirmCloseTabId: string | null = null;

	// Tab strip overflow scrolling
	let tabsContainer: HTMLDivElement;
	let canScrollLeft = false;
	let canScrollRight = false;
	let resizeObserver: ResizeObserver | null = null;

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
		return () => {
			resizeObserver?.disconnect();
			resizeObserver = null;
		};
	});

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
	<div class="tabs-container" bind:this={tabsContainer} onscroll={updateScrollButtons}>
		{#each $tabs as tab (tab.id)}
			<div
				class="tab"
				class:active={$activeTabId === tab.id}
				onclick={() => ($activeTabId = tab.id)}
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
						title="Double-click to rename"
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
		transition: all 0.2s ease;
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

	.tab-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-primary);
		font-size: 0.875rem;
	}

	.tab-name-input {
		flex: 1;
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
