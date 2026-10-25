// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Regression tests for the /api/word contract: a non-ok response must not read as "word
// not found", clearing the selection must invalidate any request still in flight, and a
// panel must fetch only once per selected word.

describe('loadWordSection error handling', () => {
	beforeEach(() => {
		vi.resetModules();
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('reports an error state when /api/word responds with a non-ok status', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: false,
				status: 500,
				statusText: 'Internal Server Error',
				json: async () => ({ error: 'Failed to fetch word data' })
			}))
		);

		const { selectWord, loadWordSection } = await import('./word-lookup');
		const { wordSectionStates } = await import('./stores');

		selectWord('cat');
		await loadWordSection('dictionary');

		expect(get(wordSectionStates).dictionary).toEqual({ status: 'error' });
	});
});

describe('loadWordSection fetching', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('fetches nothing on selection and each section once per word', async () => {
		const fetchMock = vi.fn(async () => ({
			ok: true,
			status: 200,
			json: async () => ({ found: true, word: 'cat', senses: [] })
		}));
		vi.stubGlobal('fetch', fetchMock);

		const { selectWord, loadWordSection } = await import('./word-lookup');
		const { wordSectionStates } = await import('./stores');

		selectWord('cat');
		expect(fetchMock).not.toHaveBeenCalled();

		await loadWordSection('synonyms');
		await loadWordSection('synonyms');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith('/api/word/synonyms?word=cat');
		expect(get(wordSectionStates).synonyms?.status).toBe('ready');
	});

	it('discards a response that lands after the selection was cleared', async () => {
		let releaseResponse: () => void = () => {};
		const responseGate = new Promise<void>((resolve) => {
			releaseResponse = resolve;
		});

		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				await responseGate;
				return { ok: true, status: 200, json: async () => ({ found: true, word: 'cat' }) };
			})
		);

		const { selectWord, clearSelection, loadWordSection } = await import('./word-lookup');
		const { selectedWord, wordSectionStates } = await import('./stores');

		selectWord('cat');
		const inFlight = loadWordSection('dictionary');
		clearSelection();
		releaseResponse();
		await inFlight;

		expect(get(selectedWord)).toBeNull();
		expect(get(wordSectionStates)).toEqual({});
	});
});
