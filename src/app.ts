#!/usr/bin/env node
import 'source-map-support/register';
import { downloadAndWriteMeta } from './stack/config/symbols-meta';
import { AmosStack } from './stack/stack';
import * as cdk from '@aws-cdk/core';

const LOCAL =
	process.env.npm_lifecycle_event?.includes('cdklocal') ||
	process.env.NODE_ENV === 'test';

const DOWNLOAD_SYMBOLS_META =
	process.env.DOWNLOAD_SYMBOLS_META !== 'false' &&
	process.env.DOWNLOAD_SYMBOLS_META !== '0';

const construct = () => {
	const app = new cdk.App();
	new AmosStack(app, 'amos');
};

if (LOCAL || !DOWNLOAD_SYMBOLS_META) {
	console.info('Not downloading symbols meta');
	construct();
} else {
	console.info('Downloading symbols meta');
	void downloadAndWriteMeta().then(construct);
}
