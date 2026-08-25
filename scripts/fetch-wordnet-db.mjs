#!/usr/bin/env node
// Installs the prebuilt Open English WordNet SQLite database at DATABASE_URL.
// Zip extraction uses node:zlib only so the script still runs after a --prod install.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import Database from 'better-sqlite3';

const SOURCE_URL = 'https://x-englishwordnet.github.io/sqlite/oewn-2026-sqlite-3.0.1.sqlite.zip';
const DEFAULT_TARGET = 'data/wordnet.sqlite';
const MIN_WORD_COUNT = 100000;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const LOCAL_HEADER_SIZE = 30;
const DEFLATE_METHOD = 8;
const DATA_DESCRIPTOR_FLAG = 0x08;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Reads DATABASE_URL from the project's .env without pulling in a dotenv dependency.
 * @param {string} envPath
 * @returns {string | null}
 */
function readDatabaseUrlFromEnvFile(envPath) {
	if (!existsSync(envPath)) return null;

	const lines = readFileSync(envPath, 'utf8').split(/\r?\n/);

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		const separator = trimmed.indexOf('=');
		if (separator === -1) continue;
		if (trimmed.slice(0, separator).trim() !== 'DATABASE_URL') continue;

		const value = trimmed
			.slice(separator + 1)
			.trim()
			.replace(/^['"]|['"]$/g, '');
		if (value) return value;
	}

	return null;
}

/**
 * Extracts the single deflate member of a zip archive.
 * @param {Buffer} archive
 * @returns {{ name: string, contents: Buffer }}
 */
function extractSingleZipMember(archive) {
	// Input collection
	if (archive.length < LOCAL_HEADER_SIZE) {
		throw new Error(`Archive is only ${archive.length} bytes: not a zip file`);
	}
	if (archive.readUInt32LE(0) !== LOCAL_HEADER_SIGNATURE) {
		throw new Error('Archive does not start with a zip local file header');
	}

	const flags = archive.readUInt16LE(6);
	const method = archive.readUInt16LE(8);
	const compressedSize = archive.readUInt32LE(18);
	const uncompressedSize = archive.readUInt32LE(22);
	const nameLength = archive.readUInt16LE(26);
	const extraLength = archive.readUInt16LE(28);
	const name = archive.subarray(LOCAL_HEADER_SIZE, LOCAL_HEADER_SIZE + nameLength).toString('utf8');
	const payloadStart = LOCAL_HEADER_SIZE + nameLength + extraLength;

	// Validation
	if (method !== DEFLATE_METHOD) {
		throw new Error(`Zip member "${name}" uses compression method ${method}, expected deflate`);
	}
	if ((flags & DATA_DESCRIPTOR_FLAG) !== 0 || compressedSize === 0) {
		throw new Error(`Zip member "${name}" has no size in its local header (data descriptor)`);
	}
	if (payloadStart + compressedSize > archive.length) {
		throw new Error(`Zip member "${name}" is truncated`);
	}

	// Processing
	const contents = inflateRawSync(archive.subarray(payloadStart, payloadStart + compressedSize));

	if (contents.length !== uncompressedSize) {
		throw new Error(
			`Zip member "${name}" inflated to ${contents.length} bytes, header declared ${uncompressedSize}`
		);
	}

	// Output construction
	return { name, contents };
}

/**
 * Opens an installed database readonly and counts its word rows.
 * @param {string} filePath
 * @returns {number}
 */
function countWords(filePath) {
	const db = new Database(filePath, { readonly: true });

	try {
		const row = db.prepare('SELECT COUNT(*) AS count FROM words').get();
		return row.count;
	} finally {
		db.close();
	}
}

async function main() {
	// Input collection
	const force = process.argv.slice(2).includes('--force');
	const target = readDatabaseUrlFromEnvFile(path.join(projectRoot, '.env')) ?? DEFAULT_TARGET;
	const targetPath = path.resolve(projectRoot, target);
	const tempPath = `${targetPath}.download`;

	let wordCount;

	// Edge case: already installed
	if (existsSync(targetPath) && !force) {
		console.log(`WordNet database already present at ${targetPath} (use --force to re-download)`);
		return;
	}

	// Processing
	console.log(`Downloading ${SOURCE_URL}`);
	const response = await fetch(SOURCE_URL);
	if (!response.ok) {
		throw new Error(`Download failed: ${response.status} ${response.statusText}`);
	}

	const archive = Buffer.from(await response.arrayBuffer());
	console.log(`Downloaded ${archive.length} bytes, extracting`);

	const member = extractSingleZipMember(archive);
	console.log(`Extracted ${member.name} (${member.contents.length} bytes)`);

	// Output construction
	mkdirSync(path.dirname(targetPath), { recursive: true });
	writeFileSync(tempPath, member.contents);

	// Verification runs against the download, never the installed file: a --force refresh must
	// not destroy a working database when the freshly downloaded one turns out to be unusable.
	try {
		wordCount = countWords(tempPath);
	} catch (error) {
		rmSync(tempPath, { force: true });
		throw new Error(`Verification failed for ${targetPath}: ${error.message}`, { cause: error });
	}

	if (wordCount <= MIN_WORD_COUNT) {
		rmSync(tempPath, { force: true });
		throw new Error(
			`Verification failed: words table holds ${wordCount} rows, expected more than ${MIN_WORD_COUNT}`
		);
	}

	renameSync(tempPath, targetPath);

	console.log(`Installed ${targetPath} (${wordCount} words)`);
}

main().catch((error) => {
	console.error(error.message);
	process.exit(1);
});
