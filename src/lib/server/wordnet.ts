// Open English WordNet (OEWN 2026) lookup for /api/word. Owns the readonly database
// connection, every prepared statement, and word-form resolution.
import { existsSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';
import { env } from '$env/dynamic/private';

// 's' is the adjective-satellite posid; the payload collapses it onto 'adjective'.
const POS_LABELS: Record<string, string> = {
	n: 'noun',
	v: 'verb',
	a: 'adjective',
	s: 'adjective',
	r: 'adverb'
};

const MAX_RELATION_TARGETS = 20;

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

export interface WordSense {
	sensekey: string | null;
	pos: string;
	sense_number: number | null;
	tagcount: number | null;
	domain: string;
	definition: string;
	examples: string[];
	usages: string[];
	synonyms: string[];
	relations: Record<string, RelationTarget[]>;
	ili: string | null;
	wikidata: string | null;
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
	synonyms: string[];
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

interface TextRow {
	text: string;
}

interface WordFormRow {
	word: string;
}

interface IliRow {
	ili: string;
}

interface WikidataRow {
	wikidata: string;
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
		ORDER BY s.sensenum, s.senseid
	`),

		samplesForSynset: db.prepare<[number], TextRow>(
			'SELECT sample AS text FROM samples WHERE synsetid = ? ORDER BY sampleid'
		),

		usagesForSynset: db.prepare<[number], TextRow>(
			'SELECT usagenote AS text FROM usages WHERE synsetid = ? ORDER BY usageid'
		),

		semRelationsForSynset: db.prepare<[number], RelationRow>(`
		SELECT r.relation AS relation, COALESCE(c.casedword, w.word) AS word, sy2.posid AS posid
		FROM semrelations sr
		JOIN relations r ON r.relationid = sr.relationid
		JOIN synsets sy2 ON sy2.synsetid = sr.synset2id
		JOIN senses s2 ON s2.synsetid = sr.synset2id
		JOIN words w ON w.wordid = s2.wordid
		LEFT JOIN casedwords c ON c.casedwordid = s2.casedwordid
		WHERE sr.synset1id = ?
		ORDER BY r.relation, s2.sensenum, s2.senseid
	`),

		// Lexical relations (collocation, derivation, antonym, ...) hang off one lexical unit, not
		// the whole synset. 48 (wordid, synsetid) pairs carry two luids, so scoping by word1id
		// instead of lu1id would leak one unit's relations onto the other's sense.
		lexRelationsForSense: db.prepare<[number, number], RelationRow>(`
		SELECT r.relation AS relation, COALESCE(c.casedword, w.word) AS word, sy2.posid AS posid
		FROM lexrelations lr
		JOIN relations r ON r.relationid = lr.relationid
		JOIN synsets sy2 ON sy2.synsetid = lr.synset2id
		JOIN senses s2 ON s2.synsetid = lr.synset2id AND s2.luid = lr.lu2id
		JOIN words w ON w.wordid = s2.wordid
		LEFT JOIN casedwords c ON c.casedwordid = s2.casedwordid
		WHERE lr.synset1id = ? AND lr.lu1id = ?
		ORDER BY r.relation, s2.sensenum, s2.senseid
	`),

		iliForSynset: db.prepare<[number], IliRow>('SELECT ili FROM ilis WHERE synsetid = ?'),

		wikidataForSynset: db.prepare<[number], WikidataRow>(
			'SELECT wikidata FROM wikidatas WHERE synsetid = ? ORDER BY wikidata LIMIT 1'
		)
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

function buildSense(row: SenseRow, wordid: number): WordSense {
	// Input collection
	const statements = getStatements();
	const examples = statements.samplesForSynset.all(row.synsetid);
	const usages = statements.usagesForSynset.all(row.synsetid);
	const synonyms = statements.synonymsForSynset.all(row.synsetid, wordid);
	const semRelations = statements.semRelationsForSynset.all(row.synsetid);
	const lexRelations = statements.lexRelationsForSense.all(row.synsetid, row.luid);
	const iliRow = statements.iliForSynset.get(row.synsetid);
	const wikidataRow = statements.wikidataForSynset.get(row.synsetid);

	// Output construction
	return {
		sensekey: row.sensekey,
		pos: POS_LABELS[row.posid] ?? row.posid,
		sense_number: row.sensenum,
		tagcount: row.tagcount,
		domain: row.domain,
		definition: row.definition,
		examples: examples.map((example) => example.text),
		usages: usages.map((usage) => usage.text),
		synonyms: dedupe(synonyms.map((synonym) => synonym.word)),
		relations: groupRelations([...semRelations, ...lexRelations]),
		ili: iliRow ? iliRow.ili : null,
		wikidata: wikidataRow ? wikidataRow.wikidata : null
	};
}

export function lookupWord(word: string): WordLookup {
	// Input collection
	const searchedWord = word.toLowerCase().trim();
	const variations = getWordVariations(searchedWord);
	const resolution = resolveWordForm(searchedWord, variations);

	// Edge case: no form of the word is in the database
	if (!resolution) {
		return {
			word: searchedWord,
			found: false,
			message: 'Word not found in WordNet database',
			tried_variations: variations
		};
	}

	// Processing
	const senseRows = getStatements().sensesForWord.all(resolution.wordid);
	const senses = senseRows.map((row) => buildSense(row, resolution.wordid));
	const pronunciations = buildPronunciations(resolution.wordid);

	const synonyms: string[] = [];
	const posBreakdown: Record<string, number> = {};
	let totalExamples = 0;

	for (const sense of senses) {
		synonyms.push(...sense.synonyms);
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
		synonyms: dedupe(synonyms),
		stats: {
			total_definitions: senses.length,
			total_examples: totalExamples,
			pos_breakdown: posBreakdown
		}
	};
}
