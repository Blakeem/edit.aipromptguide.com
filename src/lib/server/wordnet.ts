// Open English WordNet (OEWN 2026) lookup for /api/word. Owns the readonly database
// connection, every prepared statement, and word-form resolution.
import { existsSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';

import { CLAIMED_RELATIONS, SECTION_RELATIONS } from '../word-sections.js';
import type { RelationSectionId } from '../word-sections.js';

// 's' is the adjective-satellite posid; the payload collapses it onto 'adjective'.
const POS_LABELS: Record<string, string> = {
	n: 'noun',
	v: 'verb',
	a: 'adjective',
	s: 'adjective',
	r: 'adverb'
};

const MAX_RELATION_TARGETS = 20;

// Broad verbs have hundreds of siblings, and naming each one costs a subquery. Twice the
// display cap leaves room for siblings whose head words repeat.
const SIMILAR_CANDIDATE_LIMIT = MAX_RELATION_TARGETS * 2;

// Hypernym chains end at 'entity' within 20 steps. The cap only stops a malformed cycle.
const MAX_BROADER_CHAIN_DEPTH = 30;

// The most frequently tagged member names a synset, with sense order breaking ties.
const headWordOf = (synsetColumn: string) => `(
		SELECT COALESCE(hc.casedword, hw.word)
		FROM senses hs
		JOIN words hw ON hw.wordid = hs.wordid
		LEFT JOIN casedwords hc ON hc.casedwordid = hs.casedwordid
		WHERE hs.synsetid = ${synsetColumn}
		ORDER BY hs.tagcount IS NULL, hs.tagcount DESC, hs.sensenum, hs.senseid
		LIMIT 1
	)`;

// The unary plus keeps SQLite on the synset1id key. Without it the planner picks the
// relationid index and scans all 88k hypernym or hyponym rows per call.
const relationIdIs = (column: string, relation: string) =>
	`+${column} = (SELECT relationid FROM relations WHERE relation = '${relation}')`;

export type ResolvedVia = 'exact' | 'morph' | 'heuristic';

export interface Pronunciation {
	ipa: string;
	variety: string | null;
	pos: string;
}

export interface RelationTarget {
	word: string;
	pos: string;
}

export interface BroaderRung {
	word: string;
	definition: string;
}

export interface WordSense {
	sensekey: string | null;
	pos: string;
	sense_number: number | null;
	tagcount: number | null;
	domain: string;
	definition: string;
	examples: string[];
	usages: string[];
}

// One sense's data for one relation section. Only the fields that section uses are filled.
export interface SectionSense {
	display_number: number;
	pos: string;
	definition: string;
	synonyms: string[];
	similar_words: RelationTarget[];
	broader_chain: BroaderRung[];
	relations: Record<string, RelationTarget[]>;
}

export interface WordFound {
	word: string;
	searched_word: string;
	found: true;
	was_variation: boolean;
	resolved_via: ResolvedVia;
	display_word: string;
	pronunciations: Pronunciation[];
	total_senses: number;
	senses: WordSense[];
	stats: {
		total_definitions: number;
		total_examples: number;
		pos_breakdown: Record<string, number>;
	};
}

export interface WordNotFound {
	word: string;
	found: false;
	message: string;
	tried_variations: string[];
}

export type WordLookup = WordFound | WordNotFound;

export interface SectionFound {
	word: string;
	found: true;
	senses: SectionSense[];
}

export type SectionLookup = SectionFound | WordNotFound;

interface WordRow {
	wordid: number;
	word: string;
}

interface SenseRow {
	senseid: number;
	sensekey: string | null;
	synsetid: number;
	luid: number;
	sensenum: number | null;
	tagcount: number | null;
	posid: string;
	definition: string;
	domain: string;
	casedword: string | null;
}

interface PronunciationRow {
	ipa: string;
	variety: string | null;
	posid: string;
}

interface RelationRow {
	relation: string;
	word: string;
	posid: string;
}

interface BroaderRungRow {
	word: string;
	definition: string;
}

interface SimilarSynsetRow {
	synsetid: number;
	word: string;
	posid: string;
}

interface TextRow {
	text: string;
}

interface WordFormRow {
	word: string;
}

interface RelationNameRow {
	relation: string;
}

interface WordFormResolution {
	wordid: number;
	word: string;
	via: ResolvedVia;
}

function openDatabase(): Database.Database {
	// Input collection
	const databaseUrl = env.DATABASE_URL;

	// Validation
	if (!databaseUrl) {
		throw new Error('DATABASE_URL is not set: point it at the WordNet SQLite file');
	}

	const databasePath = path.resolve(databaseUrl);

	if (!existsSync(databasePath)) {
		throw new Error(
			`WordNet database not found at ${databasePath}. Run \`pnpm db:fetch\` to install it.`
		);
	}

	// Output construction
	return new Database(databasePath, { readonly: true, fileMustExist: true });
}

type Statements = ReturnType<typeof prepareStatements>;

let cachedStatements: Statements | null = null;

function prepareStatements(db: Database.Database) {
	return {
		wordByForm: db.prepare<[string], WordRow>('SELECT wordid, word FROM words WHERE word = ?'),

		// Irregular forms (mice -> mouse, ran -> run) recorded by OEWN as morphs.
		wordByMorph: db.prepare<[string], WordRow>(`
		SELECT w.wordid AS wordid, w.word AS word
		FROM morphs m
		JOIN lexes_morphs lm ON lm.morphid = m.morphid
		JOIN words w ON w.wordid = lm.wordid
		WHERE m.morph = ?
		ORDER BY w.word, w.wordid
		LIMIT 1
	`),

		// senses has no posid of its own; synsets supplies posid, definition and domainid.
		// sensenum is per-lexfile, so tagcount breaks the ties it leaves behind.
		sensesForWord: db.prepare<[number], SenseRow>(`
		SELECT s.senseid AS senseid, s.sensekey AS sensekey, s.synsetid AS synsetid,
		       s.luid AS luid, s.sensenum AS sensenum, s.tagcount AS tagcount,
		       sy.posid AS posid, sy.definition AS definition,
		       d.domain AS domain, c.casedword AS casedword
		FROM senses s
		JOIN synsets sy ON sy.synsetid = s.synsetid
		JOIN domains d ON d.domainid = sy.domainid
		LEFT JOIN casedwords c ON c.casedwordid = s.casedwordid
		WHERE s.wordid = ?
		ORDER BY sy.posid, s.sensenum, s.tagcount IS NULL, s.tagcount DESC, s.senseid
	`),

		pronunciationsForWord: db.prepare<[number], PronunciationRow>(`
		SELECT p.pronunciation AS ipa, lp.variety AS variety, lp.posid AS posid
		FROM lexes_pronunciations lp
		JOIN pronunciations p ON p.pronunciationid = lp.pronunciationid
		WHERE lp.wordid = ?
		ORDER BY lp.posid, lp.variety, p.pronunciation
	`),

		synonymsForSynset: db.prepare<[number, number], WordFormRow>(`
		SELECT COALESCE(c.casedword, w.word) AS word
		FROM senses s
		JOIN words w ON w.wordid = s.wordid
		LEFT JOIN casedwords c ON c.casedwordid = s.casedwordid
		WHERE s.synsetid = ? AND s.wordid <> ?
		ORDER BY s.tagcount IS NULL, s.tagcount DESC, s.sensenum, s.senseid
	`),

		// Follows the first hypernym by synsetid at each step, so the 2.7% of synsets with
		// several hypernyms yield one deterministic chain.
		broaderChainForSynset: db.prepare<[number], BroaderRungRow>(`
		WITH RECURSIVE chain(synsetid, depth) AS (
			SELECT ?, 0
			UNION ALL
			SELECT (
				SELECT sr.synset2id
				FROM semrelations sr
				WHERE sr.synset1id = chain.synsetid AND ${relationIdIs('sr.relationid', 'hypernym')}
				ORDER BY sr.synset2id
				LIMIT 1
			), chain.depth + 1
			FROM chain
			WHERE chain.synsetid IS NOT NULL AND chain.depth < ${MAX_BROADER_CHAIN_DEPTH}
		)
		SELECT ${headWordOf('chain.synsetid')} AS word, sy.definition AS definition
		FROM chain
		JOIN synsets sy ON sy.synsetid = chain.synsetid
		WHERE chain.depth > 0
		ORDER BY chain.depth
	`),

		// Co-hyponyms: the other children of this synset's hypernyms, most used first.
		siblingSynsetsForSynset: db.prepare<[number, number], SimilarSynsetRow>(`
		SELECT sib.synset2id AS synsetid, ${headWordOf('sib.synset2id')} AS word, sy.posid AS posid
		FROM semrelations up
		JOIN semrelations sib
			ON sib.synset1id = up.synset2id AND ${relationIdIs('sib.relationid', 'hyponym')}
		JOIN synsets sy ON sy.synsetid = sib.synset2id
		LEFT JOIN senses s ON s.synsetid = sib.synset2id
		WHERE up.synset1id = ? AND ${relationIdIs('up.relationid', 'hypernym')}
			AND sib.synset2id <> ?
		GROUP BY sib.synset2id
		ORDER BY SUM(COALESCE(s.tagcount, 0)) DESC, sib.synset2id
		LIMIT ${SIMILAR_CANDIDATE_LIMIT}
	`),

		similarSynsetsForSynset: db.prepare<[number], SimilarSynsetRow>(`
		SELECT sr.synset2id AS synsetid, ${headWordOf('sr.synset2id')} AS word, sy.posid AS posid
		FROM semrelations sr
		JOIN synsets sy ON sy.synsetid = sr.synset2id
		LEFT JOIN senses s ON s.synsetid = sr.synset2id
		WHERE sr.synset1id = ? AND ${relationIdIs('sr.relationid', 'similar')}
		GROUP BY sr.synset2id
		ORDER BY SUM(COALESCE(s.tagcount, 0)) DESC, sr.synset2id
	`),

		samplesForSynset: db.prepare<[number], TextRow>(
			'SELECT sample AS text FROM samples WHERE synsetid = ? ORDER BY sampleid'
		),

		usagesForSynset: db.prepare<[number], TextRow>(
			'SELECT usagenote AS text FROM usages WHERE synsetid = ? ORDER BY usageid'
		),

		relationNames: db.prepare<[], RelationNameRow>('SELECT relation FROM relations'),

		// The second parameter is a JSON array of the relation names to return.
		semRelationsForSynset: db.prepare<[number, string], RelationRow>(`
		SELECT r.relation AS relation, COALESCE(c.casedword, w.word) AS word, sy2.posid AS posid
		FROM semrelations sr
		JOIN relations r ON r.relationid = sr.relationid
		JOIN synsets sy2 ON sy2.synsetid = sr.synset2id
		JOIN senses s2 ON s2.synsetid = sr.synset2id
		JOIN words w ON w.wordid = s2.wordid
		LEFT JOIN casedwords c ON c.casedwordid = s2.casedwordid
		WHERE sr.synset1id = ? AND r.relation IN (SELECT value FROM json_each(?))
		ORDER BY r.relation, s2.sensenum, s2.senseid
	`),

		// Lexical relations (collocation, derivation, antonym, ...) hang off one lexical unit, not
		// the whole synset. 48 (wordid, synsetid) pairs carry two luids, so scoping by word1id
		// instead of lu1id would leak one unit's relations onto the other's sense.
		lexRelationsForSense: db.prepare<[number, number, string], RelationRow>(`
		SELECT r.relation AS relation, COALESCE(c.casedword, w.word) AS word, sy2.posid AS posid
		FROM lexrelations lr
		JOIN relations r ON r.relationid = lr.relationid
		JOIN synsets sy2 ON sy2.synsetid = lr.synset2id
		JOIN senses s2 ON s2.synsetid = lr.synset2id AND s2.luid = lr.lu2id
		JOIN words w ON w.wordid = s2.wordid
		LEFT JOIN casedwords c ON c.casedwordid = s2.casedwordid
		WHERE lr.synset1id = ? AND lr.lu1id = ? AND r.relation IN (SELECT value FROM json_each(?))
		ORDER BY r.relation, s2.sensenum, s2.senseid
	`)
	};
}

// The connection opens on the first lookup, not at module import: an import-time throw
// bypasses the API route's try/catch and SvelteKit answers with an opaque
// {"message":"Internal Error"}, while a lookup-time throw lands in the route's catch and
// returns a 500 whose `details` names the real cause (e.g. run `pnpm db:fetch`).
function getStatements(): Statements {
	if (!cachedStatements) {
		cachedStatements = prepareStatements(openDatabase());
	}
	return cachedStatements;
}

let cachedOtherRelations: string[] | null = null;

// The other section shows every relation the database holds that no section claims.
function relationsForSection(sectionId: RelationSectionId): string[] {
	if (sectionId !== 'other') return SECTION_RELATIONS[sectionId] ?? [];

	if (!cachedOtherRelations) {
		cachedOtherRelations = getStatements()
			.relationNames.all()
			.map((row) => row.relation)
			.filter((relation) => !CLAIMED_RELATIONS.has(relation));
	}
	return cachedOtherRelations;
}

// Function to generate word form variations
function getWordVariations(word: string): string[] {
	const variations: string[] = [word];
	const len = word.length;

	// Handle plurals and verb forms
	if (len > 3) {
		// Handle -s endings (plurals, third person verbs)
		if (word.endsWith('s') && !word.endsWith('ss')) {
			variations.push(word.slice(0, -1)); // dogs -> dog

			// Handle -ies -> -y (berries -> berry)
			if (word.endsWith('ies')) {
				variations.push(word.slice(0, -3) + 'y');
			}
			// Handle -es endings
			if (word.endsWith('es')) {
				variations.push(word.slice(0, -2)); // boxes -> box
				// Handle -ches, -shes, -xes, -zes
				if (
					word.endsWith('ches') ||
					word.endsWith('shes') ||
					word.endsWith('xes') ||
					word.endsWith('zes')
				) {
					// Already handled by -es removal
				}
				// Handle -oes -> -o (potatoes -> potato)
				if (word.endsWith('oes')) {
					variations.push(word.slice(0, -2)); // heroes -> hero
				}
			}
			// Handle -ves -> -f/-fe (knives -> knife, wolves -> wolf)
			if (word.endsWith('ves')) {
				variations.push(word.slice(0, -3) + 'f');
				variations.push(word.slice(0, -3) + 'fe');
			}
		}

		// Handle -ing endings
		if (word.endsWith('ing')) {
			const base = word.slice(0, -3);
			variations.push(base); // walking -> walk

			// Handle doubled consonants (running -> run)
			if (len > 5 && base[base.length - 1] === base[base.length - 2]) {
				variations.push(base.slice(0, -1));
			}
			// Handle silent e restoration (making -> make)
			variations.push(base + 'e');
		}

		// Handle -ed endings
		if (word.endsWith('ed')) {
			const base = word.slice(0, -2);
			variations.push(base); // walked -> walk

			// Handle -ied -> -y (carried -> carry)
			if (word.endsWith('ied')) {
				variations.push(word.slice(0, -3) + 'y');
			}
			// Handle doubled consonants (stopped -> stop)
			if (len > 4 && base[base.length - 1] === base[base.length - 2]) {
				variations.push(base.slice(0, -1));
			}
			// Handle silent e restoration (baked -> bake)
			variations.push(base + 'e');
		}

		// Handle -er endings (comparative/agent)
		if (word.endsWith('er') && len > 4) {
			const base = word.slice(0, -2);
			variations.push(base); // walker -> walk
			// Handle doubled consonants (bigger -> big)
			if (base[base.length - 1] === base[base.length - 2]) {
				variations.push(base.slice(0, -1));
			}
			// Handle silent e restoration (nicer -> nice)
			variations.push(base + 'e');
			// Handle -ier -> -y (happier -> happy)
			if (word.endsWith('ier')) {
				variations.push(word.slice(0, -3) + 'y');
			}
		}

		// Handle -est endings (superlative)
		if (word.endsWith('est') && len > 5) {
			const base = word.slice(0, -3);
			variations.push(base); // fastest -> fast
			// Handle doubled consonants (biggest -> big)
			if (base[base.length - 1] === base[base.length - 2]) {
				variations.push(base.slice(0, -1));
			}
			// Handle silent e restoration (nicest -> nice)
			variations.push(base + 'e');
			// Handle -iest -> -y (happiest -> happy)
			if (word.endsWith('iest')) {
				variations.push(word.slice(0, -4) + 'y');
			}
		}

		// Handle -ly endings (adverbs)
		if (word.endsWith('ly') && len > 4) {
			variations.push(word.slice(0, -2)); // quickly -> quick
			// Handle -ily -> -y (happily -> happy)
			if (word.endsWith('ily')) {
				variations.push(word.slice(0, -3) + 'y');
			}
		}
	}

	// Remove duplicates and return
	return [...new Set(variations)];
}

function dedupe(values: string[]): string[] {
	return [...new Set(values)];
}

function resolveWordForm(searchedWord: string, variations: string[]): WordFormResolution | null {
	const statements = getStatements();

	// Stage 1: the form as typed
	const exact = statements.wordByForm.get(searchedWord);
	if (exact) return { wordid: exact.wordid, word: exact.word, via: 'exact' };

	// Stage 2: irregular form recorded in the morphs table
	const morph = statements.wordByMorph.get(searchedWord);
	if (morph) return { wordid: morph.wordid, word: morph.word, via: 'morph' };

	// Stage 3: suffix-variation heuristic
	for (const variation of variations) {
		if (variation === searchedWord) continue;

		const candidate = statements.wordByForm.get(variation);
		if (candidate) return { wordid: candidate.wordid, word: candidate.word, via: 'heuristic' };
	}

	return null;
}

function buildPronunciations(wordid: number): Pronunciation[] {
	// Input collection
	const statements = getStatements();
	const rows = statements.pronunciationsForWord.all(wordid);

	const pronunciations: Pronunciation[] = [];
	const seen = new Set<string>();

	// Processing: the same IPA is stored once per part of speech, so collapse duplicates.
	for (const row of rows) {
		const pos = POS_LABELS[row.posid] ?? row.posid;
		const key = `${row.ipa}\u0000${row.variety ?? ''}\u0000${pos}`;

		if (seen.has(key)) continue;
		seen.add(key);
		pronunciations.push({ ipa: row.ipa, variety: row.variety, pos });
	}

	// Output construction
	return pronunciations;
}

function groupRelations(rows: RelationRow[]): Record<string, RelationTarget[]> {
	const grouped: Record<string, RelationTarget[]> = {};
	const seen = new Set<string>();

	for (const row of rows) {
		const pos = POS_LABELS[row.posid] ?? row.posid;
		const key = `${row.relation}\u0000${row.word}\u0000${pos}`;

		if (seen.has(key)) continue;
		seen.add(key);

		if (!grouped[row.relation]) grouped[row.relation] = [];
		const targets = grouped[row.relation];

		if (targets.length >= MAX_RELATION_TARGETS) continue;
		targets.push({ word: row.word, pos });
	}

	return grouped;
}

// Nouns and verbs find peers through a shared hypernym. Adjectives have no hypernyms.
// WordNet clusters them instead: a head adjective linked by 'similar' to its satellites,
// so a satellite's peers are its head plus the head's other satellites.
function buildSimilarWords(synsetid: number, posid: string, ownWord: string): RelationTarget[] {
	// Input collection
	const statements = getStatements();
	const similarWords: RelationTarget[] = [];
	const seen = new Set<string>([ownWord.toLowerCase()]);
	let rows: SimilarSynsetRow[] = [];
	let headAdjective: SimilarSynsetRow | undefined;

	// Processing
	if (posid === 'a') {
		rows = statements.similarSynsetsForSynset.all(synsetid);
	} else if (posid === 's') {
		rows = statements.similarSynsetsForSynset.all(synsetid);
		headAdjective = rows.find((row) => row.posid === 'a');
		if (headAdjective) {
			rows = [
				headAdjective,
				...statements.similarSynsetsForSynset
					.all(headAdjective.synsetid)
					.filter((row) => row.synsetid !== synsetid)
			];
		}
	} else {
		rows = statements.siblingSynsetsForSynset.all(synsetid, synsetid);
	}

	for (const row of rows) {
		const key = row.word.toLowerCase();

		if (seen.has(key)) continue;
		seen.add(key);
		similarWords.push({ word: row.word, pos: POS_LABELS[row.posid] ?? row.posid });
		if (similarWords.length >= MAX_RELATION_TARGETS) break;
	}

	// Output construction
	return similarWords;
}

function buildSense(row: SenseRow): WordSense {
	// Input collection
	const statements = getStatements();
	const examples = statements.samplesForSynset.all(row.synsetid);
	const usages = statements.usagesForSynset.all(row.synsetid);

	// Output construction
	return {
		sensekey: row.sensekey,
		pos: POS_LABELS[row.posid] ?? row.posid,
		sense_number: row.sensenum,
		tagcount: row.tagcount,
		domain: row.domain,
		definition: row.definition,
		examples: examples.map((example) => example.text),
		usages: usages.map((usage) => usage.text)
	};
}

function buildSectionSense(
	row: SenseRow,
	displayNumber: number,
	resolution: WordFormResolution,
	sectionId: RelationSectionId
): SectionSense {
	// Input collection
	const statements = getStatements();
	const relationNamesJson = JSON.stringify(relationsForSection(sectionId));
	const sense: SectionSense = {
		display_number: displayNumber,
		pos: POS_LABELS[row.posid] ?? row.posid,
		definition: row.definition,
		synonyms: [],
		similar_words: [],
		broader_chain: [],
		relations: {}
	};

	// Processing: each section runs only its own queries
	if (sectionId === 'synonyms') {
		sense.synonyms = dedupe(
			statements.synonymsForSynset
				.all(row.synsetid, resolution.wordid)
				.map((synonym) => synonym.word)
		);
	} else if (sectionId === 'similar') {
		sense.similar_words = buildSimilarWords(row.synsetid, row.posid, resolution.word);
	} else {
		sense.relations = groupRelations([
			...statements.semRelationsForSynset.all(row.synsetid, relationNamesJson),
			...statements.lexRelationsForSense.all(row.synsetid, row.luid, relationNamesJson)
		]);
		if (sectionId === 'broader') {
			sense.broader_chain = statements.broaderChainForSynset.all(row.synsetid);
		}
	}

	// Output construction
	return sense;
}

function hasSectionContent(sense: SectionSense): boolean {
	return (
		sense.synonyms.length > 0 ||
		sense.similar_words.length > 0 ||
		sense.broader_chain.length > 0 ||
		Object.keys(sense.relations).length > 0
	);
}

function notFound(searchedWord: string, variations: string[]): WordNotFound {
	return {
		word: searchedWord,
		found: false,
		message: 'Word not found in WordNet database',
		tried_variations: variations
	};
}

export function lookupWord(word: string): WordLookup {
	// Input collection
	const searchedWord = word.toLowerCase().trim();
	const variations = getWordVariations(searchedWord);
	const resolution = resolveWordForm(searchedWord, variations);

	// Edge case: no form of the word is in the database
	if (!resolution) return notFound(searchedWord, variations);

	// Processing
	const senseRows = getStatements().sensesForWord.all(resolution.wordid);
	const senses = senseRows.map((row) => buildSense(row));
	const pronunciations = buildPronunciations(resolution.wordid);

	const posBreakdown: Record<string, number> = {};
	let totalExamples = 0;

	for (const sense of senses) {
		posBreakdown[sense.pos] = (posBreakdown[sense.pos] ?? 0) + 1;
		totalExamples += sense.examples.length;
	}

	// Output construction: 63 words carry more than one casedword, so the display form is
	// pinned to the first sense in canonical order rather than picked arbitrarily.
	return {
		word: resolution.word,
		searched_word: searchedWord,
		found: true,
		was_variation: resolution.word !== searchedWord,
		resolved_via: resolution.via,
		display_word: senseRows[0]?.casedword ?? resolution.word,
		pronunciations,
		total_senses: senses.length,
		senses,
		stats: {
			total_definitions: senses.length,
			total_examples: totalExamples,
			pos_breakdown: posBreakdown
		}
	};
}

// Senses keep the dictionary's order, so display_number matches the dictionary's numbering.
// Senses with nothing for the section are left out.
export function lookupSection(word: string, sectionId: RelationSectionId): SectionLookup {
	// Input collection
	const searchedWord = word.toLowerCase().trim();
	const variations = getWordVariations(searchedWord);
	const resolution = resolveWordForm(searchedWord, variations);

	// Edge case: no form of the word is in the database
	if (!resolution) return notFound(searchedWord, variations);

	// Processing
	const senseRows = getStatements().sensesForWord.all(resolution.wordid);
	const senses = senseRows
		.map((row, index) => buildSectionSense(row, index + 1, resolution, sectionId))
		.filter(hasSectionContent);

	// Output construction
	return { word: resolution.word, found: true, senses };
}
