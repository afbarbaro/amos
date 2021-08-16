import { providerConfigurations } from '../api';
import {
	ApiFileConfig,
	ApiProvider,
	ApiRateLimit,
	ApiMessageKey,
} from '../types';
import { S3 } from '@aws-sdk/client-s3';
import { SendMessageBatchRequestEntry, SQS } from '@aws-sdk/client-sqs';
import getStream = require('get-stream');
import { Stream } from 'stream';

const SQS_BATCH_MAX_MESSAGES = 9;
const SQS_DELAY_MAX_SECONDS = 900;

const s3 = new S3({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
	forcePathStyle: true,
});

const sqs = new SQS({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

type Event = {
	queueUrl: string;
	options?: { skipQueueing?: boolean };
	itemsQueued?: number;
	waitSeconds?: number;
	delaySeconds?: { [K in ApiProvider]?: number };
	queuedAllItems?: { [K in ApiProvider]?: boolean };
	lastQueuedItem?: { [K in ApiProvider]?: ApiMessageKey };
	callCounts?: { [K in ApiProvider]?: Record<string, number> };
	rateLimits?: { [K in ApiProvider]?: ApiRateLimit };
};

type Result = Event & {
	itemsQueued: number;
	waitSeconds: number;
	delaySeconds: { [K in ApiProvider]?: number };
	queuedAllItems: { [K in ApiProvider]?: boolean };
	lastQueuedItem: { [K in ApiProvider]?: ApiMessageKey };
	callCounts: { [K in ApiProvider]?: Record<string, number> };
	rateLimits: { [K in ApiProvider]?: ApiRateLimit };
};

// eslint-disable-next-line complexity
export const handler = async (event: Event): Promise<Result> => {
	// Exit early if queueing is to be skipped
	const queue = !event.options?.skipQueueing;

	// Initialize outputs
	let waitSeconds = 0;
	let itemsQueued = 0;
	let messages: SendMessageBatchRequestEntry[] = [];
	const delaySeconds = event.delaySeconds || {};
	const queuedAllItems = event.queuedAllItems || {};
	const lastQueuedItem = event.lastQueuedItem || {};
	const callCounts = event.callCounts || {};
	const rateLimits = event.rateLimits || {};
	const messagePromises = [];

	// Loop through provider configurations
	for (const config of providerConfigurations) {
		const provider = config.provider;

		// Do nothing if this config is disabled or if this provider was fully previously fully queued
		if (!queue || config.disabled || queuedAllItems[provider]) {
			continue;
		}

		// Read config from S3
		const { Body: configFile } = await s3.getObject({
			Bucket: process.env.FORECAST_BUCKET_NAME,
			Key: `config/api.config.${provider}.json`,
		});
		const configJson = JSON.parse(
			await getStream(configFile as Stream)
		) as ApiFileConfig;

		// Initialize timings
		const providerCallCounts = callCounts[provider] || {};
		const prevQueueingTimeString = Object.keys(providerCallCounts).pop();
		const prevQueueingTime = prevQueueingTimeString
			? Date.parse(prevQueueingTimeString)
			: 0;
		const now = new Date();
		let queueingTime = new Date();
		if (prevQueueingTime) {
			queueingTime = new Date(prevQueueingTime);
		} else {
			queueingTime.setUTCSeconds(0, 0);
		}
		let isoTime = queueingTime.toISOString().substring(0, 16) + 'Z';
		let minuteFraction = prevQueueingTime ? 1 : (60 - now.getUTCSeconds()) / 60;
		delaySeconds[provider] = Math.max(
			0,
			Math.ceil((queueingTime.getTime() - now.getTime()) / 1000)
		);

		// Initialize tracking for provider rate limit
		let reachedQueueDelayLimit = false;
		rateLimits[provider] = config.rateLimit;
		callCounts[provider] = providerCallCounts;
		providerCallCounts[isoTime] = providerCallCounts[isoTime] || 0;

		// Loop through configured calls
		for (const [type, call] of Object.entries(config.calls.timeseries)) {
			// Do nothing if this call is disabled or
			// we've reached the rate limit for the provider or
			// this was already fully processed in a previous execution
			if (call.disabled || reachedQueueDelayLimit) {
				continue;
			}

			// Loop through symbols for this call
			let lastQueuedItemFound = false;
			const providerPartiallyProcessed = queuedAllItems[provider] === false;
			for (const symbol of configJson[type].symbols) {
				// Do nothing until we find the last item previously queued for the provider
				if (providerPartiallyProcessed && !lastQueuedItemFound) {
					lastQueuedItemFound = symbol === lastQueuedItem?.[provider]?.symbol;
					continue;
				}

				// Account for rate limit
				const callsInMinute = providerCallCounts[isoTime];
				if (callsInMinute >= config.rateLimit.perMinute * minuteFraction) {
					queueingTime = new Date(queueingTime.getTime() + 60000);
					isoTime = queueingTime.toISOString().substring(0, 16) + 'Z';
					minuteFraction = 1;
					providerCallCounts[isoTime] = 1;
					const delay = Math.max(
						0,
						Math.ceil((queueingTime.getTime() - now.getTime()) / 1000)
					);
					if (delay > SQS_DELAY_MAX_SECONDS) {
						reachedQueueDelayLimit = true;
						queuedAllItems[provider] = false;
						providerCallCounts[isoTime] = 0;
						break;
					}
					delaySeconds[provider] = delay;
				} else {
					providerCallCounts[isoTime] = providerCallCounts[isoTime] + 1;
				}

				// Track call
				lastQueuedItem[provider] = {
					provider,
					type,
					function: call.function,
					symbol,
				};

				// Parameters for the API call
				const params = {
					provider,
					type,
					symbol,
					call,
				};

				// Construct API call message to be queued
				const messageId = `${provider}-${type}-${symbol.replace('.', '_')}-${
					call.function
				}`;
				messages.push({
					Id: messageId,
					MessageBody: JSON.stringify(params),
					DelaySeconds: delaySeconds[provider],
				});
				itemsQueued++;

				// Send batch of messages to the queue if we reach the batch size limit
				if (messages.length === SQS_BATCH_MAX_MESSAGES) {
					messagePromises.push(
						sqs
							.sendMessageBatch({
								QueueUrl: event.queueUrl,
								Entries: messages,
							})
							.then((output) => {
								for (const failed of output.Failed || []) {
									console.error(failed.Message);
								}
							})
							.catch((error) => {
								console.error(error);
								return;
							})
					);
					messages = [];
				}
			}
		}

		// Set provider to fully processed
		if (reachedQueueDelayLimit) {
			// Wait 1/2 of the queueing delay with a minimum wait of 60 seconds
			const delay = Math.trunc((delaySeconds[provider] || 0) / 120) * 60;
			waitSeconds = Math.max(60, Math.min(waitSeconds || delay, delay));
		} else {
			queuedAllItems[provider] = true;
			delete lastQueuedItem[provider];
		}
	}

	// Send last batch of messages to the queue
	if (messages.length > 0) {
		messagePromises.push(
			sqs
				.sendMessageBatch({
					QueueUrl: event.queueUrl,
					Entries: messages,
				})
				.then((output) => {
					for (const failed of output.Failed || []) {
						console.error(failed.Message);
					}
				})
				.catch((error) => {
					console.error(error);
					return;
				})
		);
	}

	// Wait for all promises to resolve
	await Promise.all(messagePromises);

	// Output
	return {
		...event,
		itemsQueued,
		queuedAllItems,
		lastQueuedItem,
		callCounts,
		rateLimits,
		delaySeconds,
		waitSeconds,
	};
};
