import {
	ListStateMachinesCommand,
	SFNClient,
	StartExecutionCommand,
} from '@aws-sdk/client-sfn';

describe('Run dataset step function', () => {
	test('execute', async () => {
		process.env.AWS_ENDPOINT_URL = undefined;

		const client = new SFNClient({});
		const listCommand = new ListStateMachinesCommand({});
		const stateMachines = await client.send(listCommand);
		let executionArn: string | undefined = '';
		for (const stateMachine of stateMachines.stateMachines || []) {
			if (stateMachine.name?.includes('DatasetStateMachine')) {
				const command = new StartExecutionCommand({
					stateMachineArn: stateMachine.stateMachineArn,
					input: JSON.stringify({
						skipQueueing: false,
						downloadStartDate: '2010-01-01',
						downloadEndDate: '0d',
						symbols: ['NET'],
					}),
				});
				const output = await client.send(command);
				executionArn = output.executionArn;
			}
		}

		expect(executionArn).toBeTruthy();
	});
});
