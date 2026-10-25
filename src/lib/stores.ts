import { writable, derived, get } from 'svelte/store';

import type { SectionLookup, WordLookup } from './server/wordnet.js';
import { WORD_SECTION_IDS } from './word-sections.js';
import type { RelationSectionId, WordSectionId } from './word-sections.js';

// Tab interface
export interface Tab {
	id: string;
	name: string;
	content: string;
	lastModified: Date;
	wordCount: number;
	characterCount: number;
}

// Create initial tab
const createInitialTab = (): Tab => ({
	id: crypto.randomUUID(),
	name: 'Untitled Document',
	content: '',
	lastModified: new Date(),
	wordCount: 0,
	characterCount: 0
});

// localStorage round-trips Date through JSON, so a stored tab carries lastModified as a string.
type StoredTab = Omit<Tab, 'lastModified'> & { lastModified: string };

// Load state from localStorage or use defaults
const loadStoredState = () => {
	if (typeof window === 'undefined') return null;

	try {
		const stored = localStorage.getItem('prompt-editor-state');
		return stored ? JSON.parse(stored) : null;
	} catch {
		return null;
	}
};

const storedState = loadStoredState();

// Theme store
export const isDarkMode = writable<boolean>(storedState?.isDarkMode ?? false);

// Debounced auto-save function
let saveTimeout: NodeJS.Timeout;
const debouncedSave = () => {
	if (typeof window !== 'undefined') {
		clearTimeout(saveTimeout);
		saveTimeout = setTimeout(() => saveState(), 1000); // 1 second debounce
	}
};

// Auto-save on theme changes
isDarkMode.subscribe(() => {
	debouncedSave();
});

// Word sidebar open or collapsed state (persisted), open by default
export const wordPanelOpen = writable<boolean>(storedState?.wordPanelOpen ?? true);

// Auto-save on word panel toggle
wordPanelOpen.subscribe(() => {
	debouncedSave();
});

const DEFAULT_OPEN_WORD_SECTIONS: WordSectionId[] = ['dictionary', 'synonyms'];

// localStorage is user-writable, so unknown and repeated ids are dropped instead of trusted.
// A stored list with no known id falls back to the defaults, since an open sidebar with no
// panel shows nothing.
const loadOpenWordSections = (): WordSectionId[] => {
	const stored: unknown = storedState?.openWordSections;
	const storedIds: unknown[] = Array.isArray(stored) ? stored : [];
	const known = storedIds.filter(
		(id, index): id is WordSectionId =>
			WORD_SECTION_IDS.includes(id as WordSectionId) && storedIds.indexOf(id) === index
	);

	return known.length > 0 ? known : [...DEFAULT_OPEN_WORD_SECTIONS];
};

// Sidebar panels that are shown, in display order (persisted)
export const openWordSections = writable<WordSectionId[]>(loadOpenWordSections());

openWordSections.subscribe(() => {
	debouncedSave();
});

// A shown panel is appended below the others. Closing the last one collapses the sidebar,
// as the sidebar holds nothing else.
export const toggleWordSection = (sectionId: WordSectionId) => {
	let remainingOpen = 0;

	openWordSections.update((openIds) => {
		const next = openIds.includes(sectionId)
			? openIds.filter((id) => id !== sectionId)
			: [...openIds, sectionId];
		remainingOpen = next.length;
		return next;
	});

	if (remainingOpen === 0) wordPanelOpen.set(false);
};

// toIndex is the panel's index in the reordered list, after its removal from its old slot.
export const moveWordSection = (sectionId: WordSectionId, toIndex: number) => {
	openWordSections.update((openIds) => {
		const fromIndex = openIds.indexOf(sectionId);
		const reordered = [...openIds];

		if (fromIndex === -1 || fromIndex === toIndex) return openIds;

		reordered.splice(fromIndex, 1);
		reordered.splice(toIndex, 0, sectionId);
		return reordered;
	});
};

type WordSectionHeights = Partial<Record<WordSectionId, number>>;

// Only finite positive numbers under known ids survive, since localStorage is user-writable.
const loadWordSectionHeights = (): WordSectionHeights => {
	const stored: unknown = storedState?.wordSectionHeights;
	const heights: WordSectionHeights = {};

	if (typeof stored !== 'object' || stored === null) return heights;

	for (const id of WORD_SECTION_IDS) {
		const height = (stored as Record<string, unknown>)[id];
		if (typeof height === 'number' && Number.isFinite(height) && height > 0) heights[id] = height;
	}
	return heights;
};

// Heights the user dragged a panel to, in px (persisted). A panel absent here sizes to its
// content, up to a share of the sidebar.
export const wordSectionHeights = writable<WordSectionHeights>(loadWordSectionHeights());

wordSectionHeights.subscribe(() => {
	debouncedSave();
});

// null returns the panel to sizing by its content.
export const setWordSectionHeight = (sectionId: WordSectionId, height: number | null) => {
	wordSectionHeights.update((heights) => {
		const next = { ...heights };

		if (height === null) delete next[sectionId];
		else next[sectionId] = Math.round(height);
		return next;
	});
};

// Whether the chip row that shows and hides panels is expanded (persisted)
export const sectionPickerOpen = writable<boolean>(storedState?.sectionPickerOpen === true);

sectionPickerOpen.subscribe(() => {
	debouncedSave();
});

// A sidebar reopened after its last panel closed would show an empty stack.
export const expandWordPanel = () => {
	openWordSections.update((openIds) => (openIds.length > 0 ? openIds : ['dictionary']));
	wordPanelOpen.set(true);
};

// localStorage is user- and extension-writable, so the persisted tabs may be absent, empty,
// or not an array at all; every one of those falls back to a single fresh tab.
const loadStoredTabs = (): Tab[] => {
	if (!Array.isArray(storedState?.tabs) || storedState.tabs.length === 0) {
		return [createInitialTab()];
	}

	try {
		return storedState.tabs.map((tab: StoredTab) => ({
			...tab,
			lastModified: new Date(tab.lastModified)
		}));
	} catch {
		return [createInitialTab()];
	}
};

// Tabs store
export const tabs = writable<Tab[]>(loadStoredTabs());

// Auto-save on tab changes (after tabs is declared)
tabs.subscribe(() => {
	debouncedSave();
});

// Active tab store
export const activeTabId = writable<string>(storedState?.activeTabId ?? '');

// Reconcile activeTabId with the loaded tabs: an empty or unknown stored id would leave the
// tab bar with nothing highlighted (one-shot: run the callback once, then unsubscribe)
const unsubTabsInit = tabs.subscribe(($tabs) => {
	let storedActiveId = '';
	activeTabId.subscribe((value) => (storedActiveId = value))();

	if ($tabs.length > 0 && !$tabs.some((tab) => tab.id === storedActiveId)) {
		activeTabId.set($tabs[0].id);
	}
});
unsubTabsInit();

// Derived store for the active tab
export const activeTab = derived(
	[tabs, activeTabId],
	([$tabs, $activeTabId]) => $tabs.find((tab) => tab.id === $activeTabId) || $tabs[0]
);

// The word every sidebar panel describes
export const selectedWord = writable<string | null>(null);

export type SectionLoadState<Result> =
	{ status: 'loading' } | { status: 'ready'; result: Result } | { status: 'error' };

export type WordSectionStates = { dictionary?: SectionLoadState<WordLookup> } & {
	[Id in RelationSectionId]?: SectionLoadState<SectionLookup>;
};

// Load state of each panel's data for the selected word. A panel absent here has not been
// opened since the word was selected, so nothing was fetched for it.
export const wordSectionStates = writable<WordSectionStates>({});

// The span of the editor word the panel was opened from. Replacing a word writes into this
// span, so any typing clears it rather than leaving it pointing at shifted text.
export interface EditorWordRange {
	tabId: string;
	start: number;
	end: number;
	word: string;
}

export const editorWordRange = writable<EditorWordRange | null>(null);

// The span belongs to one tab, so replacing is offered only while that tab is showing.
export const replaceTarget = derived([editorWordRange, activeTabId], ([$range, $activeTabId]) =>
	$range && $range.tabId === $activeTabId ? $range.word : null
);

// Carries the original's capitalization over: 'Big' -> 'Large', 'BIG' -> 'LARGE'.
export const matchCase = (original: string, replacement: string): string => {
	const isAllCaps =
		original.length > 1 &&
		original === original.toUpperCase() &&
		original !== original.toLowerCase();
	const isCapitalized = original[0] !== undefined && original[0] !== original[0].toLowerCase();

	if (isAllCaps) return replacement.toUpperCase();
	if (isCapitalized) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
	return replacement;
};

export const replaceEditorWord = (replacement: string): boolean => {
	// Input collection
	const range = get(editorWordRange);
	const tab = get(tabs).find((candidate) => candidate.id === range?.tabId);
	let casedReplacement = '';

	// Validation: the span must still hold the word it was recorded with
	if (!range || !tab || tab.content.slice(range.start, range.end) !== range.word) return false;

	// Processing
	casedReplacement = matchCase(range.word, replacement);
	updateTabContent(
		tab.id,
		tab.content.slice(0, range.start) + casedReplacement + tab.content.slice(range.end)
	);

	// Output construction
	editorWordRange.set({
		tabId: tab.id,
		start: range.start,
		end: range.start + casedReplacement.length,
		word: casedReplacement
	});
	return true;
};

// Save state to localStorage
export const saveState = () => {
	if (typeof window === 'undefined') return;

	let currentTabs: Tab[] = [];
	let currentActiveTabId = '';
	let currentIsDarkMode = false;
	let currentWordPanelOpen = true;
	let currentOpenWordSections: WordSectionId[] = [];
	let currentWordSectionHeights: WordSectionHeights = {};
	let currentSectionPickerOpen = false;

	tabs.subscribe((value) => (currentTabs = value))();
	activeTabId.subscribe((value) => (currentActiveTabId = value))();
	isDarkMode.subscribe((value) => (currentIsDarkMode = value))();
	wordPanelOpen.subscribe((value) => (currentWordPanelOpen = value))();
	openWordSections.subscribe((value) => (currentOpenWordSections = value))();
	wordSectionHeights.subscribe((value) => (currentWordSectionHeights = value))();
	sectionPickerOpen.subscribe((value) => (currentSectionPickerOpen = value))();

	const state = {
		tabs: currentTabs,
		activeTabId: currentActiveTabId,
		isDarkMode: currentIsDarkMode,
		wordPanelOpen: currentWordPanelOpen,
		openWordSections: currentOpenWordSections,
		wordSectionHeights: currentWordSectionHeights,
		sectionPickerOpen: currentSectionPickerOpen,
		lastSaved: new Date().toISOString()
	};

	try {
		localStorage.setItem('prompt-editor-state', JSON.stringify(state));

		// Trigger save indicator
		if (typeof window !== 'undefined') {
			window.dispatchEvent(new CustomEvent('autosave'));
		}
	} catch (error) {
		console.warn('Failed to save state to localStorage:', error);
	}
};

// Tab management functions
export const createNewTab = () => {
	const newTab = createInitialTab();
	tabs.update((currentTabs) => [...currentTabs, newTab]);
	activeTabId.set(newTab.id);
	return newTab;
};

export const closeTab = (tabId: string) => {
	tabs.update((currentTabs) => {
		const closedIndex = currentTabs.findIndex((tab) => tab.id === tabId);
		const filtered = currentTabs.filter((tab) => tab.id !== tabId);
		let currentActiveId = '';

		activeTabId.subscribe((value) => (currentActiveId = value))();

		if (filtered.length === 0) {
			// Create a new tab if we're closing the last one
			const newTab = createInitialTab();
			activeTabId.set(newTab.id);
			return [newTab];
		}

		// Closing the active tab activates the tab that sat immediately before it.
		// Removal at closedIndex leaves earlier entries in place, so filtered[closedIndex - 1]
		// is the previous tab; index 0 falls back to the new first tab.
		if (currentActiveId === tabId) {
			activeTabId.set(filtered[Math.max(0, closedIndex - 1)].id);
		}

		return filtered;
	});
};

// toIndex is the tab's index in the reordered array, after its removal from fromIndex.
export const moveTab = (tabId: string, toIndex: number) => {
	tabs.update((currentTabs) => {
		const fromIndex = currentTabs.findIndex((tab) => tab.id === tabId);
		const reordered = [...currentTabs];

		if (fromIndex === -1 || fromIndex === toIndex) return currentTabs;

		const [movedTab] = reordered.splice(fromIndex, 1);
		reordered.splice(toIndex, 0, movedTab);
		return reordered;
	});
};

export const renameTab = (tabId: string, newName: string) => {
	tabs.update((currentTabs) =>
		currentTabs.map((tab) =>
			tab.id === tabId
				? { ...tab, name: newName.trim() || 'Untitled Document', lastModified: new Date() }
				: tab
		)
	);
};

export const updateTabContent = (tabId: string, content: string) => {
	tabs.update((currentTabs) =>
		currentTabs.map((tab) =>
			tab.id === tabId
				? {
						...tab,
						content,
						lastModified: new Date(),
						wordCount: content
							.trim()
							.split(/\s+/)
							.filter((w) => w.length > 0).length,
						characterCount: content.length
					}
				: tab
		)
	);
	// Content changes trigger debounced save
	debouncedSave();
};
