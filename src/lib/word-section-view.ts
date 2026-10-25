// Turns one relation section's payload into the groups its sidebar panel renders.
import { SECTION_RELATIONS } from './word-sections.js';
import type { RelationSectionId, WordSectionId } from './word-sections.js';
import type { BroaderRung, RelationTarget, SectionSense } from './server/wordnet.js';

export interface ChipRow {
	label: string | null;
	targets: RelationTarget[];
}

// One sense's share of a section.
export interface SenseGroup {
	displayNumber: number;
	pos: string;
	definition: string;
	chain: BroaderRung[];
	rows: ChipRow[];
}

export const SECTION_TITLES: Record<WordSectionId, string> = {
	dictionary: 'Dictionary',
	synonyms: 'Synonyms',
	similar: 'Similar words',
	opposites: 'Opposites',
	broader: 'Broader and narrower',
	family: 'Word family',
	'used-with': 'Used with',
	parts: 'Parts and wholes',
	other: 'Other relations'
};

const RELATION_LABELS: Record<string, string> = {
	hyponym: 'Narrower words',
	derivation: 'Derived forms',
	pertainym: 'Pertains to',
	participle: 'Participle of',
	'part meronym': 'Has parts',
	'part holonym': 'Part of',
	'member meronym': 'Has members',
	'member holonym': 'Member of',
	'substance meronym': 'Made of',
	'substance holonym': 'Substance in'
};

const labelRelation = (relation: string) =>
	RELATION_LABELS[relation] ?? relation.charAt(0).toUpperCase() + relation.slice(1);

// Listed sections keep their relation order. The other section has no list, so its
// relations sort by name.
function relationRows(sense: SectionSense, sectionId: RelationSectionId): ChipRow[] {
	// Input collection
	const listed = SECTION_RELATIONS[sectionId];
	const relations = listed ?? Object.keys(sense.relations).sort((a, b) => a.localeCompare(b));
	const isSingleRelation = listed?.length === 1;

	// Output construction
	return relations
		.filter((relation) => (sense.relations[relation]?.length ?? 0) > 0)
		.map((relation) => ({
			label: isSingleRelation ? null : labelRelation(relation),
			targets: sense.relations[relation]
		}));
}

function broaderRows(sense: SectionSense): ChipRow[] {
	// The chain follows one hypernym, so a sense with several lists the rest beside it.
	const otherBroader = (sense.relations.hypernym ?? []).filter(
		(target) => target.word !== sense.broader_chain[0]?.word
	);

	return [
		{ label: 'Other broader words', targets: otherBroader },
		{ label: labelRelation('hyponym'), targets: sense.relations.hyponym ?? [] }
	].filter((row) => row.targets.length > 0);
}

function sectionRows(sense: SectionSense, sectionId: RelationSectionId): ChipRow[] {
	switch (sectionId) {
		case 'synonyms':
			return [{ label: null, targets: sense.synonyms.map((word) => ({ word, pos: sense.pos })) }];
		case 'similar':
			return [{ label: null, targets: sense.similar_words }];
		case 'broader':
			return broaderRows(sense);
		default:
			return relationRows(sense, sectionId);
	}
}

export function buildSenseGroups(
	senses: SectionSense[],
	sectionId: RelationSectionId
): SenseGroup[] {
	return senses.map((sense) => ({
		displayNumber: sense.display_number,
		pos: sense.pos,
		definition: sense.definition,
		chain: sense.broader_chain,
		rows: sectionRows(sense, sectionId)
	}));
}

export function countGroupWords(groups: SenseGroup[]): number {
	const uniqueWords = new Set<string>();

	for (const group of groups) {
		for (const rung of group.chain) uniqueWords.add(rung.word);
		for (const row of group.rows) for (const target of row.targets) uniqueWords.add(target.word);
	}
	return uniqueWords.size;
}
