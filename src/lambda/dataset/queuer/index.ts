import { providerConfigurations } from '../api';
import { ApiProvider, ApiRateLimit } from '../types';
import { SendMessageBatchRequestEntry, SQS } from '@aws-sdk/client-sqs';
import { Context, Handler } from 'aws-lambda';

const SQS_BATCH_MAX_MESSAGES = 10;

const sqs = new SQS({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

// eslint-disable-next-line complexity
export const handler: Handler = async (
	event: { queueUrl: string; options?: { skipQueueing?: boolean } },
	_context: Context
): Promise<{
	itemsQueued: number;
	waitSeconds: number;
	rateLimits: { [K in ApiProvider]?: ApiRateLimit };
}> => {
	// Exit early if queueing is to be skipped
	const queue = !event.options?.skipQueueing;

	let messages: SendMessageBatchRequestEntry[] = [];
	let itemsQueued = 0;
	const rateLimits: { [K in ApiProvider]?: ApiRateLimit } = {};

	// Loop through types
	for (const config of providerConfigurations) {
		// Do nothiing if this config is disabled
		if (config.disabled || !queue) {
			continue;
		}

		// Assign provider rate limit
		rateLimits[config.provider] = config.rateLimit;

		// Loop through configured calls
		for (const [type, call] of Object.entries(config.calls)) {
			// Do nothing if this call is disabled
			if (call.disabled) {
				continue;
			}

			// Loop through symbols for this call
			for (const symbol of call.symbols) {
				// Parameters for the API calls
				const params = {
					provider: config.provider,
					type,
					symbol,
					call,
				};

				// Construct API call message to be queued
				const messageId = `${type}-${symbol.replace('.', '_')}-${
					call.function
				}`;
				messages.push({
					Id: messageId,
					MessageDeduplicationId: messageId,
					MessageGroupId: 'default',
					MessageBody: JSON.stringify(params),
				});
				itemsQueued++;

				// Send batch of messages to the queue if we reach the batch size limit
				if (messages.length === SQS_BATCH_MAX_MESSAGES) {
					await sqs.sendMessageBatch({
						QueueUrl: event.queueUrl,
						Entries: messages,
					});
					messages = [];
				}
			}
		}
	}

	// Send last batch of messages to the queue
	if (messages.length > 0) {
		await sqs.sendMessageBatch({
			QueueUrl: event.queueUrl,
			Entries: messages,
		});
	}

	// Output
	return { ...event, itemsQueued, rateLimits, waitSeconds: 60 };
};
