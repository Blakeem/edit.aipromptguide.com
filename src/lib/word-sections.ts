// Shared by the server, which fetches one section at a time, and the sidebar, which renders
// one panel per section. Holds no server code, so client modules may import it.

export const WORD_SECTION_IDS = [
	'dictionary',
	'synonyms',
	'similar',
	'opposites',
	'broader',
	'family',
	'used-with',
	'parts',
	'other'
] as const;

export type WordSectionId = (typeof WORD_SECTION_IDS)[number];
export type RelationSectionId = Exclude<WordSectionId, 'dictionary'>;

export const isRelationSectionId = (value: string): value is RelationSectionId =>
	value !== 'dictionary' && (WORD_SECTION_IDS as readonly string[]).includes(value);

// WordNet relation names each section shows, in display order.
export const SECTION_RELATIONS: Partial<Record<RelationSectionId, string[]>> = {
	opposites: ['antonym'],
	broader: ['hypernym', 'hyponym'],
	family: ['derivation', 'pertainym', 'participle'],
	'used-with': ['collocation'],
	parts: [
		'part meronym',
		'part holonym',
		'member meronym',
		'member holonym',
		'substance meronym',
		'substance holonym'
	]
};

// The other section shows every relation not listed here. 'similar' links adjectives to
// their cluster, which the similar section already shows in full.
export const CLAIMED_RELATIONS = new Set([...Object.values(SECTION_RELATIONS).flat(), 'similar']);
