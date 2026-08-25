// Single owner of /api/word fetches and of the `selectedWordData` transition that goes with
// them. The request id lives at module scope so a newer selection cancels an older in-flight
// one no matter which component started it.
import { selectedWordData } from './stores.js';
import type { Pronunciation, RelationTarget, WordSense } from './server/wordnet.js';

// Type-only re-export: the payload shape the panel renders, without pulling the server
// module (and its database handle) into client code.
export type { Pronunciation, RelationTarget, WordSense };

let latestRequestId = 0;

export async function selectWord(word: string): Promise<void> {
	// Input collection
	const requestId = ++latestRequestId;

	// Mark the selection pending before the network round trip.
	selectedWordData.set({ word, data: null, loading: true });

	try {
		const response = await fetch(`/api/word?word=${encodeURIComponent(word)}`);
		if (requestId !== latestRequestId) return;

		// Error bodies carry no `found` field, so they must not fall through to the
		// not-found branch below — an outage would read as "word not in WordNet".
		if (!response.ok) {
			console.error(`Failed to fetch word data: /api/word responded ${response.status}`);
			selectedWordData.update((current) => ({
				...current,
				data: { error: true, message: 'Failed to fetch word data' },
				loading: false
			}));
			return;
		}

		const data = await response.json();
		if (requestId !== latestRequestId) return;

		selectedWordData.update((current) => ({
			...current,
			data: data.found ? data : { found: false, word },
			loading: false
		}));
	} catch (error) {
		if (requestId !== latestRequestId) return;
		console.error('Failed to fetch word data:', error);
		selectedWordData.update((current) => ({
			...current,
			data: { error: true, message: 'Failed to fetch word data' },
			loading: false
		}));
	}
}

// Bumping the request id is what makes clearing stick: an in-flight selectWord() response
// would otherwise pass its guards and repopulate the panel the user just cleared.
export function clearSelection(): void {
	latestRequestId++;
	selectedWordData.set({ word: null, data: null, loading: false });
}
