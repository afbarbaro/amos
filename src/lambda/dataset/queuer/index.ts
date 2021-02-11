import { config } from '../api.config';
import { SendMessageBatchRequestEntry, SQS } from '@aws-sdk/client-sqs';
import { Context, Handler } from 'aws-lambda';

const sqs = new SQS({
	endpoint: process.env.AWS_ENDPOINT_URL,
	region: process.env.AWS_REGION,
});

export const handler: Handler = async (
	event: { queueUrl: string },
	_context: Context
): Promise<{
	queueUrl: string;
	itemsQueued: number;
	waitSeconds: number;
}> => {
	const messages: SendMessageBatchRequestEntry[] = [];
	for (const [type, call] of Object.entries(config)) {
		for (let i = 0; i < call.functions.length; i++) {
			for (const symbol of call.symbols) {
				const params = {
					type,
					symbol,
					function: call.functions[i],
					...call.parameters[i],
				};

				messages.push({
					Id: `${type}-${symbol}-${call.functions[i]}`,
					MessageBody: JSON.stringify(params),
				});
			}
		}
	}

	if (messages.length > 0) {
		await sqs.sendMessageBatch({
			QueueUrl: event.queueUrl,
			Entries: messages,
		});
	}

	return {
		...event,
		itemsQueued: messages.length,
		waitSeconds: 60,
	};
};
