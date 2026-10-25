// @vitest-environment node
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, beforeAll } from 'vitest';

import type { RelationSectionId } from '../word-sections';
import type { SectionFound, SectionLookup, WordFound, WordLookup } from './wordnet';

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

function expectSectionFound(result: SectionLookup): SectionFound {
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
	});

	it('returns GB and US pronunciations for fox', () => {
		const result = expectFound(lookupWord('fox'));
		const varieties = result.pronunciations.map((pronunciation) => pronunciation.variety);

		expect(varieties).toContain('GB');
		expect(varieties).toContain('US');
		expect(result.pronunciations.every((pronunciation) => pronunciation.ipa.length > 0)).toBe(true);
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

	it('reports stats over the senses it returns', () => {
		const result = expectFound(lookupWord('fox'));

		expect(result.stats.total_definitions).toBe(result.senses.length);
		expect(result.stats.total_examples).toBe(
			result.senses.reduce((total, sense) => total + sense.examples.length, 0)
		);
		expect(result.stats.pos_breakdown.noun).toBe(5);
		expect(result.stats.pos_breakdown.verb).toBe(3);
	});

	it('reports a miss with the variations it tried', () => {
		const result = lookupWord('zzqxwvfoobarbaz');

		expect(result.found).toBe(false);
		if (result.found) throw new Error('expected a miss');
		expect(result.word).toBe('zzqxwvfoobarbaz');
		expect(result.tried_variations).toContain('zzqxwvfoobarbaz');
	});
});

describe.skipIf(databaseMissing)('lookupSection (OEWN 2026)', () => {
	let lookupSection: (word: string, sectionId: RelationSectionId) => SectionLookup;

	beforeAll(async () => {
		({ lookupSection } = await import('./wordnet'));
	});

	const senseByDefinition = (result: SectionFound, definitionStart: string) =>
		result.senses.filter((sense) => sense.definition.startsWith(definitionStart));

	it('numbers senses in dictionary order and leaves out senses with nothing to show', () => {
		const result = expectSectionFound(lookupSection('fox', 'synonyms'));
		const numbers = result.senses.map((sense) => sense.display_number);

		expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
		expect(numbers).not.toContain(1);
		expect(result.senses.every((sense) => sense.synonyms.length > 0)).toBe(true);
	});

	it('fills only the requested section', () => {
		const result = expectSectionFound(lookupSection('fox', 'synonyms'));

		for (const sense of result.senses) {
			expect(sense.relations).toEqual({});
			expect(sense.broader_chain).toEqual([]);
			expect(sense.similar_words).toEqual([]);
		}
	});

	it('keeps synonyms free of the word itself and of repeats', () => {
		const result = expectSectionFound(lookupSection('fox', 'synonyms'));

		for (const sense of result.senses) {
			expect(sense.synonyms).not.toContain('fox');
			expect(new Set(sense.synonyms).size).toBe(sense.synonyms.length);
		}
	});

	it('orders synonyms by tag count, most used first', () => {
		const result = expectSectionFound(lookupSection('run', 'synonyms'));
		const [testingSense] = senseByDefinition(result, 'the act of testing something');

		expect(testingSense.synonyms).toEqual(['trial', 'test']);
	});

	it('builds the broader chain from the nearest hypernym up to entity', () => {
		const result = expectSectionFound(lookupSection('fox', 'broader'));
		const animalSense = result.senses[0];
		const chainWords = animalSense.broader_chain.map((rung) => rung.word);

		expect(animalSense.display_number).toBe(1);
		expect(chainWords[0]).toMatch(/^can(ine|id)$/);
		expect(chainWords).toContain('mammal');
		expect(chainWords.at(-1)).toBe('entity');
		expect(animalSense.broader_chain.every((rung) => rung.definition.length > 0)).toBe(true);
		expect(animalSense.relations.hypernym.map((target) => target.word)).toContain(chainWords[0]);
	});

	it('caps every relation group at 20 targets', () => {
		const result = expectSectionFound(lookupSection('fox', 'broader'));

		for (const targets of Object.values(result.senses[0].relations)) {
			expect(targets.length).toBeLessThanOrEqual(20);
		}
	});

	it('scopes lexical relations to one lexical unit when a word has two in a synset', () => {
		const definition = 'the abode of mortals';
		const collocations = senseByDefinition(
			expectSectionFound(lookupSection('earth', 'used-with')),
			definition
		);
		const families = senseByDefinition(
			expectSectionFound(lookupSection('earth', 'family')),
			definition
		);

		expect(collocations).toHaveLength(1);
		expect(collocations[0].relations.collocation.map((target) => target.word)).toEqual(
			expect.arrayContaining(['heaven', 'residence'])
		);
		expect(families).toHaveLength(2);
		for (const sense of families) {
			expect(sense.relations.derivation.map((target) => target.word)).toContain('earthly');
		}
	});

	it('finds noun siblings through a shared hypernym', () => {
		const result = expectSectionFound(lookupSection('fox', 'similar'));
		const similarWords = result.senses[0].similar_words.map((target) => target.word);

		expect(similarWords).toEqual(expect.arrayContaining(['wolf', 'jackal']));
		expect(similarWords).not.toContain('fox');
		expect(new Set(similarWords).size).toBe(similarWords.length);
	});

	it('finds adjective peers through the similar cluster, with no broader chain', () => {
		const definition = 'allowing light to pass through';
		const [similarSense] = senseByDefinition(
			expectSectionFound(lookupSection('clear', 'similar')),
			definition
		);
		const broaderSenses = senseByDefinition(
			expectSectionFound(lookupSection('clear', 'broader')),
			definition
		);

		expect(similarSense.similar_words.map((target) => target.word)).toEqual(
			expect.arrayContaining(['transparent', 'translucent'])
		);
		expect(broaderSenses).toEqual([]);
	});

	it('leads a satellite adjective peer list with its head adjective', () => {
		const result = expectSectionFound(lookupSection('happy', 'similar'));
		const [fortuneSense] = senseByDefinition(result, 'marked by good fortune');

		expect(fortuneSense.similar_words[0].word).toBe('fortunate');
	});

	it('gives the other section only relations no section claims', () => {
		const result = expectSectionFound(lookupSection('fox', 'other'));
		const relations = result.senses.flatMap((sense) => Object.keys(sense.relations));

		expect(relations.length).toBeGreaterThan(0);
		for (const claimed of ['hypernym', 'hyponym', 'antonym', 'derivation', 'collocation']) {
			expect(relations).not.toContain(claimed);
		}
	});
});
