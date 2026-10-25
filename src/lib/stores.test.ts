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

describe('moveTab reordering', () => {
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

	const seedThreeTabs = () =>
		installBrowserGlobals({
			tabs: [makeTab('tab-0', 'A'), makeTab('tab-1', 'B'), makeTab('tab-2', 'C')],
			activeTabId: 'tab-0',
			isDarkMode: false
		});

	it('moves a tab rightward to the given final index', async () => {
		seedThreeTabs();
		const stores = await import('./stores');

		stores.moveTab('tab-0', 2);

		expect(get(stores.tabs).map((tab) => tab.id)).toEqual(['tab-1', 'tab-2', 'tab-0']);
	});

	it('moves a tab leftward to the given final index', async () => {
		seedThreeTabs();
		const stores = await import('./stores');

		stores.moveTab('tab-2', 0);

		expect(get(stores.tabs).map((tab) => tab.id)).toEqual(['tab-2', 'tab-0', 'tab-1']);
	});

	it('keeps the same array when the index is unchanged or the id is unknown', async () => {
		seedThreeTabs();
		const stores = await import('./stores');
		const before = get(stores.tabs);

		stores.moveTab('tab-1', 1);
		stores.moveTab('tab-missing', 0);

		expect(get(stores.tabs)).toBe(before);
	});
});

describe('word section accordion', () => {
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

	it('drops unknown stored section ids and keeps canonical order', async () => {
		installBrowserGlobals({
			tabs: [makeTab('tab-0', 'A')],
			openWordSections: ['parts', 'bogus', 'dictionary']
		});

		const stores = await import('./stores');

		expect(get(stores.openWordSections)).toEqual(['dictionary', 'parts']);
	});

	it('collapses the panel when the last open section closes', async () => {
		installBrowserGlobals({ tabs: [makeTab('tab-0', 'A')], openWordSections: ['synonyms'] });

		const stores = await import('./stores');

		stores.toggleWordSection('synonyms');

		expect(get(stores.openWordSections)).toEqual([]);
		expect(get(stores.wordPanelOpen)).toBe(false);
	});

	it('reopens the sidebar with the dictionary when no panel was left open', async () => {
		installBrowserGlobals({ tabs: [makeTab('tab-0', 'A')], openWordSections: ['synonyms'] });

		const stores = await import('./stores');

		stores.toggleWordSection('synonyms');
		stores.expandWordPanel();

		expect(get(stores.openWordSections)).toEqual(['dictionary']);
		expect(get(stores.wordPanelOpen)).toBe(true);
	});
});

describe('replaceEditorWord', () => {
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

	const seedText = (content: string) =>
		installBrowserGlobals({
			tabs: [{ ...makeTab('tab-0', 'A'), content }],
			activeTabId: 'tab-0'
		});

	it('carries capitalization and all caps over to the replacement', async () => {
		seedText('');
		const { matchCase } = await import('./stores');

		expect(matchCase('big', 'large')).toBe('large');
		expect(matchCase('Big', 'large')).toBe('Large');
		expect(matchCase('BIG', 'large')).toBe('LARGE');
		expect(matchCase('A', 'one')).toBe('One');
	});

	it('replaces the recorded span and moves the span onto the replacement', async () => {
		seedText('A Big dog barks.');
		const stores = await import('./stores');

		stores.editorWordRange.set({ tabId: 'tab-0', start: 2, end: 5, word: 'Big' });

		expect(stores.replaceEditorWord('large')).toBe(true);
		expect(get(stores.tabs)[0].content).toBe('A Large dog barks.');
		expect(get(stores.editorWordRange)).toEqual({
			tabId: 'tab-0',
			start: 2,
			end: 7,
			word: 'Large'
		});
	});

	it('refuses when the span no longer holds the recorded word', async () => {
		seedText('A small dog barks.');
		const stores = await import('./stores');

		stores.editorWordRange.set({ tabId: 'tab-0', start: 2, end: 5, word: 'Big' });

		expect(stores.replaceEditorWord('large')).toBe(false);
		expect(get(stores.tabs)[0].content).toBe('A small dog barks.');
	});
});

describe('stored sidebar panels', () => {
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

	it('falls back to the default panels when no stored id is known', async () => {
		installBrowserGlobals({ tabs: [makeTab('tab-0', 'A')], openWordSections: ['meanings'] });

		const stores = await import('./stores');

		expect(get(stores.openWordSections)).toEqual(['dictionary', 'synonyms']);
	});
});
