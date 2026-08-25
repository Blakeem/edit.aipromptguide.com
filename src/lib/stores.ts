import { writable, derived } from 'svelte/store';

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

// Word Explorer panel open/collapsed state (persisted); default open
export const wordPanelOpen = writable<boolean>(storedState?.wordPanelOpen ?? true);

// Auto-save on word panel toggle
wordPanelOpen.subscribe(() => {
	debouncedSave();
});

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

// Word data store for the current selection
export const selectedWordData = writable<{
	word: string | null;
	// Carries three runtime shapes: a WordNet hit, a miss, or a fetch failure. WordDetails
	// narrows them in its template, which a union type here cannot express; tightening this
	// means moving that narrowing into the component script first.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	data: any;
	loading: boolean;
}>({
	word: null,
	data: null,
	loading: false
});

// Save state to localStorage
export const saveState = () => {
	if (typeof window === 'undefined') return;

	let currentTabs: Tab[] = [];
	let currentActiveTabId = '';
	let currentIsDarkMode = false;
	let currentWordPanelOpen = true;

	tabs.subscribe((value) => (currentTabs = value))();
	activeTabId.subscribe((value) => (currentActiveTabId = value))();
	isDarkMode.subscribe((value) => (currentIsDarkMode = value))();
	wordPanelOpen.subscribe((value) => (currentWordPanelOpen = value))();

	const state = {
		tabs: currentTabs,
		activeTabId: currentActiveTabId,
		isDarkMode: currentIsDarkMode,
		wordPanelOpen: currentWordPanelOpen,
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
