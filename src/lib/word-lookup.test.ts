// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';

// Regression tests for the two /api/word contract defects (issues root-p1-3 and
// root-p1-4): a non-ok response must not read as "word not found", and clearing the
// selection must invalidate any request still in flight.

describe('selectWord error handling', () => {
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

		const { selectWord } = await import('./word-lookup');
		const { selectedWordData } = await import('./stores');

		await selectWord('cat');

		const state = get(selectedWordData);
		expect(state.loading).toBe(false);
		expect(state.data).toEqual({ error: true, message: 'Failed to fetch word data' });
	});
});

describe('clearSelection', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
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

		const { selectWord, clearSelection } = await import('./word-lookup');
		const { selectedWordData } = await import('./stores');

		const inFlight = selectWord('cat');
		clearSelection();
		releaseResponse();
		await inFlight;

		expect(get(selectedWordData)).toEqual({ word: null, data: null, loading: false });
	});
});
