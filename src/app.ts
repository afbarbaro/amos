#!/usr/bin/env node
import 'source-map-support/register';
import { AmosStack } from './stack/stack';
import * as cdk from '@aws-cdk/core';

const app = new cdk.App();
new AmosStack(app, 'AmosStack');
