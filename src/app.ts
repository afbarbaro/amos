#!/usr/bin/env node
import 'source-map-support/register';
import { downloadAndWriteMeta } from './stack/config/symbols-meta';
import { AmosStack } from './stack/stack';
import * as cdk from '@aws-cdk/core';

const TEST = process.env.NODE_ENV === 'test';
const LOCAL = process.env.npm_lifecycle_event!.includes('cdklocal') || TEST;

const construct = () => {
	const app = new cdk.App();
	new AmosStack(app, 'amos');
};

if (LOCAL) {
	construct();
} else {
	void downloadAndWriteMeta().then(construct);
}
