// Single owner of /api/word fetches. Selecting a word fetches nothing. Each open sidebar
// panel requests its own section, so a closed panel costs no query. The request id lives at
// module scope so a newer selection discards responses for an older one, whichever panel
// started them.
import { get } from 'svelte/store';

import { editorWordRange, selectedWord, wordSectionStates } from './stores.js';
import type { WordSectionId } from './word-sections.js';
import type {
	BroaderRung,
	Pronunciation,
	RelationTarget,
	SectionLookup,
	SectionSense,
	WordLookup,
	WordSense
} from './server/wordnet.js';

// Type-only re-export: the payload shapes the panels render, without pulling the server
// module (and its database handle) into client code.
export type {
	BroaderRung,
	Pronunciation,
	RelationTarget,
	SectionLookup,
	SectionSense,
	WordLookup,
	WordSense
};

let latestRequestId = 0;

export function selectWord(word: string): void {
	// Reselecting the current word keeps the data already loaded for it.
	if (word === get(selectedWord)) return;

	latestRequestId++;
	wordSectionStates.set({});
	selectedWord.set(word);
}

// Bumping the request id is what makes clearing stick: an in-flight response would
// otherwise pass its guard and repopulate the panels the user just cleared.
export function clearSelection(): void {
	latestRequestId++;
	wordSectionStates.set({});
	selectedWord.set(null);
	editorWordRange.set(null);
}

// Idempotent per selection: a panel calls it whenever it is open, and only the first call
// for a word fetches. A failed load retries on the next call.
export async function loadWordSection(sectionId: WordSectionId): Promise<void> {
	// Input collection
	const requestId = latestRequestId;
	const word = get(selectedWord);
	const currentState = get(wordSectionStates)[sectionId];
	const endpoint = sectionId === 'dictionary' ? '/api/word' : `/api/word/${sectionId}`;

	// Edge cases: nothing selected, or this section is already loading or loaded
	if (!word || currentState?.status === 'loading' || currentState?.status === 'ready') return;

	// Processing
	wordSectionStates.update((states) => ({ ...states, [sectionId]: { status: 'loading' } }));

	try {
		const response = await fetch(`${endpoint}?word=${encodeURIComponent(word)}`);
		if (requestId !== latestRequestId) return;

		// Error bodies carry no `found` field, so they must not reach the ready state, where
		// an outage would read as "word not in WordNet".
		if (!response.ok) {
			console.error(`Failed to fetch ${sectionId}: ${endpoint} responded ${response.status}`);
			wordSectionStates.update((states) => ({ ...states, [sectionId]: { status: 'error' } }));
			return;
		}

		const result: WordLookup | SectionLookup = await response.json();
		if (requestId !== latestRequestId) return;

		// Output construction
		wordSectionStates.update((states) => ({ ...states, [sectionId]: { status: 'ready', result } }));
	} catch (error) {
		if (requestId !== latestRequestId) return;
		console.error(`Failed to fetch ${sectionId}:`, error);
		wordSectionStates.update((states) => ({ ...states, [sectionId]: { status: 'error' } }));
	}
}
