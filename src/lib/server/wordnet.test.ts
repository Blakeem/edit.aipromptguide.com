// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll } from 'vitest';

import type { WordFound, WordLookup } from './wordnet';

// The suite skips itself when the database is absent, so a fresh checkout that has not run
// `pnpm db:fetch` still collects. The module is imported dynamically in beforeAll to keep
// its connection out of every run that skips.
const databasePath = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../../data/wordnet.sqlite'
);
const databaseMissing = !existsSync(databasePath);

if (databaseMissing) {
	console.log(`Skipping wordnet tests: no database at ${databasePath} (run \`pnpm db:fetch\`)`);
}

function expectFound(result: WordLookup): WordFound {
	if (!result.found) throw new Error(`expected "${result.word}" to be found`);
	return result;
}

describe.skipIf(databaseMissing)('lookupWord (OEWN 2026)', () => {
	let lookupWord: (word: string) => WordLookup;

	beforeAll(async () => {
		({ lookupWord } = await import('./wordnet'));
	});

	it('orders fox senses with the noun animal sense first', () => {
		const result = expectFound(lookupWord('fox'));

		expect(result.resolved_via).toBe('exact');
		expect(result.was_variation).toBe(false);
		expect(result.senses).toHaveLength(8);
		expect(result.total_senses).toBe(8);
		expect(result.senses[0].pos).toBe('noun');
		expect(result.senses[0].domain).toBe('animal');
		expect(result.senses[0].tagcount).toBe(3);
		expect(result.senses[0].definition).toContain('mammal');
		expect(result.senses[0].ili).toMatch(/^i\d+$/);
	});

	it('returns GB and US pronunciations for fox', () => {
		const result = expectFound(lookupWord('fox'));
		const varieties = result.pronunciations.map((pronunciation) => pronunciation.variety);

		expect(varieties).toContain('GB');
		expect(varieties).toContain('US');
		expect(result.pronunciations.every((pronunciation) => pronunciation.ipa.length > 0)).toBe(true);
	});

	it('groups the fox animal sense relations by relation name', () => {
		const result = expectFound(lookupWord('fox'));
		const hypernyms = result.senses[0].relations.hypernym ?? [];

		expect(hypernyms.map((target) => target.word)).toEqual(
			expect.arrayContaining([expect.stringMatching(/^can(ine|id)$/)])
		);
		expect(hypernyms.every((target) => target.pos === 'noun')).toBe(true);
		for (const targets of Object.values(result.senses[0].relations)) {
			expect(targets.length).toBeLessThanOrEqual(20);
		}
	});

	it('scopes lexical relations to one lexical unit when a word has two in a synset', () => {
		const result = expectFound(lookupWord('earth'));
		const senses = result.senses.filter((sense) =>
			sense.definition.startsWith('the abode of mortals')
		);

		expect(senses).toHaveLength(2);

		const withCollocations = senses.filter((sense) => sense.relations.collocation);

		expect(withCollocations).toHaveLength(1);
		expect(withCollocations[0].relations.collocation.map((target) => target.word)).toEqual(
			expect.arrayContaining(['heaven', 'residence'])
		);
		for (const sense of senses) {
			expect(sense.relations.derivation.map((target) => target.word)).toContain('earthly');
		}
	});

	it('resolves an irregular plural through the morphs table', () => {
		const result = expectFound(lookupWord('mice'));

		expect(result.word).toBe('mouse');
		expect(result.searched_word).toBe('mice');
		expect(result.resolved_via).toBe('morph');
		expect(result.was_variation).toBe(true);
	});

	it('resolves a regular plural through the suffix heuristic', () => {
		const result = expectFound(lookupWord('dogs'));

		expect(result.word).toBe('dog');
		expect(result.resolved_via).toBe('heuristic');
		expect(result.was_variation).toBe(true);
	});

	it('reports the cased display form', () => {
		const result = expectFound(lookupWord('january'));

		expect(result.display_word).toBe('January');
		expect(result.word).toBe('january');
	});

	it('reports stats and a synonym union that excludes the word itself', () => {
		const result = expectFound(lookupWord('fox'));

		expect(result.stats.total_definitions).toBe(result.senses.length);
		expect(result.stats.total_examples).toBe(
			result.senses.reduce((total, sense) => total + sense.examples.length, 0)
		);
		expect(result.stats.pos_breakdown.noun).toBe(5);
		expect(result.stats.pos_breakdown.verb).toBe(3);
		expect(result.synonyms).not.toContain('fox');
		expect(new Set(result.synonyms).size).toBe(result.synonyms.length);
	});

	it('reports a miss with the variations it tried', () => {
		const result = lookupWord('zzqxwvfoobarbaz');

		expect(result.found).toBe(false);
		if (result.found) throw new Error('expected a miss');
		expect(result.word).toBe('zzqxwvfoobarbaz');
		expect(result.tried_variations).toContain('zzqxwvfoobarbaz');
	});
});
