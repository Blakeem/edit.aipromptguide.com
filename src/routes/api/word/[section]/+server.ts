// One relation section of a word, fetched only when its sidebar panel is open
import { json } from '@sveltejs/kit';
import { lookupSection } from '$lib/server/wordnet';
import { isRelationSectionId } from '$lib/word-sections';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url }) => {
	// Input collection
	const word = url.searchParams.get('word');
	const sectionId = params.section;

	// Input validation
	if (!word) {
		return json({ error: 'Word parameter is required' }, { status: 400 });
	}
	if (!isRelationSectionId(sectionId)) {
		return json({ error: `Unknown section: ${sectionId}` }, { status: 404 });
	}

	// Processing / output construction
	try {
		return json(lookupSection(word, sectionId));
	} catch (error) {
		console.error(`Error fetching ${sectionId} for word:`, error);
		return json(
			{
				error: 'Failed to fetch word data',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
