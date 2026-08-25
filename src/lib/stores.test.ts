// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Regression test for the leaked `tabs.subscribe` in the activeTabId
// initialization (issue src-lib-p1-2): the init subscription must be a
// one-shot, otherwise every later `tabs` mutation snaps the editor back
// to the first tab.

const makeTab = (id: string, name: string) => ({
	id,
	name,
	content: '',
	lastModified: new Date().toISOString(),
	wordCount: 0,
	characterCount: 0
});

// The store module reads browser globals as it initializes, so the node environment has to
// carry stand-ins. globalThis is not typed with them, hence the widened view.
const browserGlobals = globalThis as unknown as Record<string, unknown>;

function installBrowserGlobals(seed: unknown) {
	const backing = new Map<string, string>();
	backing.set('prompt-editor-state', JSON.stringify(seed));
	browserGlobals.localStorage = {
		getItem: (k: string) => backing.get(k) ?? null,
		setItem: (k: string, v: string) => backing.set(k, v),
		removeItem: (k: string) => backing.delete(k)
	};
	// window aliases globalThis, so dispatchEvent lands on the same object either way.
	browserGlobals.window = globalThis;
	browserGlobals.dispatchEvent = () => true;
	browserGlobals.CustomEvent = class {
		constructor(
			public type: string,
			public init?: unknown
		) {}
	};
}

describe('activeTabId initialization', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetModules();
	});

	afterEach(() => {
		vi.useRealTimers();
		delete browserGlobals.window;
		delete browserGlobals.localStorage;
		delete browserGlobals.CustomEvent;
	});

	it('does not reset the active tab when a non-first tab is edited', async () => {
		installBrowserGlobals({
			tabs: [makeTab('tab-0', 'A'), makeTab('tab-1', 'B')],
			activeTabId: '', // empty -> triggers the init branch
			isDarkMode: false
		});

		const stores = await import('./stores');

		// The one-shot init selects the first tab.
		expect(get(stores.activeTabId)).toBe('tab-0');

		// User switches to the second tab and edits it.
		stores.activeTabId.set('tab-1');
		stores.updateTabContent('tab-1', 'hello world');

		// The active tab must stay put (the leaked subscription would snap
		// it back to 'tab-0').
		expect(get(stores.activeTabId)).toBe('tab-1');
	});
});

// Regression test for unvalidated persisted state (issue root-p1-2): localStorage is
// user- and extension-writable, so corrupted state must degrade to a usable editor
// instead of throwing during module init or leaving no active tab.
describe('persisted state normalization', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetModules();
	});

	afterEach(() => {
		vi.useRealTimers();
		delete browserGlobals.window;
		delete browserGlobals.localStorage;
		delete browserGlobals.CustomEvent;
	});

	it('falls back to one fresh tab when stored tabs is not an array', async () => {
		installBrowserGlobals({
			tabs: { 'tab-0': makeTab('tab-0', 'A') },
			activeTabId: 'tab-0',
			isDarkMode: false
		});

		const stores = await import('./stores');

		const loaded = get(stores.tabs);
		expect(loaded).toHaveLength(1);
		expect(get(stores.activeTabId)).toBe(loaded[0].id);
	});

	it('falls back to one fresh tab when stored tabs is empty', async () => {
		installBrowserGlobals({ tabs: [], activeTabId: '', isDarkMode: false });

		const stores = await import('./stores');

		const loaded = get(stores.tabs);
		expect(loaded).toHaveLength(1);
		expect(get(stores.activeTabId)).toBe(loaded[0].id);
		expect(get(stores.activeTab)).toBe(loaded[0]);
	});

	it('reconciles a stored activeTabId that matches no loaded tab', async () => {
		installBrowserGlobals({
			tabs: [makeTab('tab-0', 'A'), makeTab('tab-1', 'B')],
			activeTabId: 'tab-removed-elsewhere',
			isDarkMode: false
		});

		const stores = await import('./stores');

		expect(get(stores.activeTabId)).toBe('tab-0');
	});
});

describe('closeTab activation', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.resetModules();
	});

	afterEach(() => {
		vi.useRealTimers();
		delete browserGlobals.window;
		delete browserGlobals.localStorage;
		delete browserGlobals.CustomEvent;
	});

	it('activates the previous tab when the active tab is not first', async () => {
		installBrowserGlobals({
			tabs: [makeTab('tab-0', 'A'), makeTab('tab-1', 'B'), makeTab('tab-2', 'C')],
			activeTabId: 'tab-2',
			isDarkMode: false
		});

		const stores = await import('./stores');

		stores.closeTab('tab-2');

		expect(get(stores.tabs).map((tab) => tab.id)).toEqual(['tab-0', 'tab-1']);
		expect(get(stores.activeTabId)).toBe('tab-1');
	});

	it('activates the new first tab when the active first tab is closed', async () => {
		installBrowserGlobals({
			tabs: [makeTab('tab-0', 'A'), makeTab('tab-1', 'B'), makeTab('tab-2', 'C')],
			activeTabId: 'tab-0',
			isDarkMode: false
		});

		const stores = await import('./stores');

		stores.closeTab('tab-0');

		expect(get(stores.tabs).map((tab) => tab.id)).toEqual(['tab-1', 'tab-2']);
		expect(get(stores.activeTabId)).toBe('tab-1');
	});

	it('leaves the active tab alone when an inactive tab is closed', async () => {
		installBrowserGlobals({
			tabs: [makeTab('tab-0', 'A'), makeTab('tab-1', 'B'), makeTab('tab-2', 'C')],
			activeTabId: 'tab-1',
			isDarkMode: false
		});

		const stores = await import('./stores');

		stores.closeTab('tab-0');

		expect(get(stores.tabs).map((tab) => tab.id)).toEqual(['tab-1', 'tab-2']);
		expect(get(stores.activeTabId)).toBe('tab-1');
	});

	it('creates and activates a fresh tab when the sole tab is closed', async () => {
		installBrowserGlobals({
			tabs: [makeTab('tab-0', 'A')],
			activeTabId: 'tab-0',
			isDarkMode: false
		});

		const stores = await import('./stores');

		stores.closeTab('tab-0');

		const remaining = get(stores.tabs);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).not.toBe('tab-0');
		expect(get(stores.activeTabId)).toBe(remaining[0].id);
	});
});
