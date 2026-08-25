// WordNet API endpoint - returns all data for a given word
import { json } from '@sveltejs/kit';
import { lookupWord } from '$lib/server/wordnet';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	// Input collection
	const word = url.searchParams.get('word');

	// Input validation
	if (!word) {
		return json({ error: 'Word parameter is required' }, { status: 400 });
	}

	// Processing / output construction
	try {
		return json(lookupWord(word));
	} catch (error) {
		console.error('Error fetching word data:', error);
		return json(
			{
				error: 'Failed to fetch word data',
				details: error instanceof Error ? error.message : 'Unknown error'
			},
			{ status: 500 }
		);
	}
};
