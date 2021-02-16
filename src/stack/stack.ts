import { ForecastDatasetResource } from './forecast/forecast';
import { LambdaIntegration, RestApi } from '@aws-cdk/aws-apigateway';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Code, Function, IFunction, Runtime } from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Bucket, IBucket } from '@aws-cdk/aws-s3';
import { Queue } from '@aws-cdk/aws-sqs';
import {
	Choice,
	Condition,
	Fail,
	JsonPath,
	StateMachine,
	Succeed,
	TaskInput,
	Wait,
	WaitTime,
} from '@aws-cdk/aws-stepfunctions';
import { LambdaInvoke } from '@aws-cdk/aws-stepfunctions-tasks';
import * as cdk from '@aws-cdk/core';
import { CfnOutput, Duration } from '@aws-cdk/core';
import { existsSync, readdirSync } from 'fs';
import * as path from 'path';

const TEST = process.env.NODE_ENV === 'test';
const LOCAL = process.env.npm_lifecycle_event!.includes('cdklocal') || TEST;

const srcPath = path.resolve(__dirname, '..');
const codePath = LOCAL ? srcPath.replace('/src', '/dist') : srcPath;
const lambdaPath = path.resolve(codePath, 'lambda');

export class AmosStack extends cdk.Stack {
	constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// Forecast custom resource
		const forecast = new ForecastDatasetResource(this, `${id}-forecast`, {
			local: LOCAL,
		});

		// Create Lambda Functions
		this.createLambdas(forecast);
	}

	private createLambdas(forecast: ForecastDatasetResource) {
		// Create API Gateway
		const api = new RestApi(this, 'api', {});

		// Create Bucket for localstack Lambda functions code
		const s3Bucket = LOCAL
			? Bucket.fromBucketName(this, 'LocalStackBucket', '__local__')
			: undefined;

		// Lambda IAM Policy
		const lambdaPolicy = new PolicyStatement({
			resources: ['*'],
			actions: [
				'forecast:*',
				's3:getObject',
				's3:putObject',
				'sqs:sendMessage*',
				'sqs:receiveMessage',
				'sqs:deleteMessage*',
				'iam:PassRole',
			],
		});
		const lambdaEnvironment = {
			FORECAST_ROLE_ARN: forecast.assumeRoleArn,
			FORECAST_BUCKET_NAME: forecast.bucketName,
			FORECAST_DATASET_PREFIX: forecast.node.id.replace('-', '_'),
			FORECAST_DATASET_ARN: forecast.datasetArn,
			FORECAST_DATASET_GROUP_ARN: forecast.datasetGroupArn,
		};

		readdirSync(lambdaPath).forEach((lambdaDir) => {
			this.log(`Configuring Lambda ${lambdaDir}`);

			const folder = path.resolve(lambdaPath, lambdaDir, 'queuer');
			if (!LOCAL && existsSync(folder)) {
				this.createStateMachine(
					lambdaDir,
					lambdaPolicy,
					lambdaEnvironment,
					Duration.seconds(30)
				);
			} else {
				this.createLambda(
					s3Bucket,
					lambdaDir,
					lambdaEnvironment,
					lambdaPolicy,
					Duration.seconds(30),
					api
				);
			}
		});
	}

	private createStateMachine(
		lambdaDir: string,
		lambdaPolicy: PolicyStatement,
		lambdaEnvironment: Record<string, string>,
		lambdaTimeout: Duration
	): StateMachine {
		// SQS Queue
		const queue = new Queue(this, 'Queue', {
			fifo: true,
			queueName: `${this.artifactId}-queue.fifo`,
		});

		// Queuer Lambda
		const queuerLambda = new NodejsFunction(this, 'QueuerLambda', {
			entry: `${lambdaPath}/${lambdaDir}/queuer/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			environment: lambdaEnvironment,
			initialPolicy: [lambdaPolicy],
		});
		const queuerStep = new LambdaInvoke(this, 'Queuer', {
			lambdaFunction: queuerLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				queueUrl: queue.queueUrl,
				options: JsonPath.entirePayload,
			}),
		});

		// Worker Lambda
		const workerLambda = new NodejsFunction(this, 'WorkerLambda', {
			entry: `${lambdaPath}/${lambdaDir}/worker/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			environment: {
				...lambdaEnvironment,
				RAPIDAPI_KEY: process.env.RAPIDAPI_KEY || '',
				DATA_API_MAX_CALLS_PER_MINUTE:
					process.env.DATA_API_MAX_CALLS_PER_MINUTE || '1',
			},
			initialPolicy: [lambdaPolicy],
		});
		const workerStep = new LambdaInvoke(this, 'Worker', {
			lambdaFunction: workerLambda,
			payloadResponseOnly: true,
		});

		// Import Lambda
		const importLambda = new NodejsFunction(this, 'ImportLambda', {
			entry: `${lambdaPath}/${lambdaDir}/import/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			environment: lambdaEnvironment,
			initialPolicy: [lambdaPolicy],
		});
		const importStep = new LambdaInvoke(this, 'Import', {
			lambdaFunction: importLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({ requestType: 'CREATE' }),
		});
		const importStatusStep = new LambdaInvoke(this, 'Import Status', {
			lambdaFunction: importLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'STATUS',
				importJobArn: JsonPath.stringAt('$.importJobArn'),
			}),
		});

		// Predictor Lambda
		const predictorLambda = new NodejsFunction(this, 'PredictorLambda', {
			entry: `${lambdaPath}/${lambdaDir}/predictor/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			environment: {
				...lambdaEnvironment,
				FORECAST_PREDICTOR_ALGORITHM_ARN:
					process.env.FORECAST_PREDICTOR_ALGORITHM_ARN || '',
				FORECAST_PREDICTOR_HORIZON_DAYS:
					process.env.FORECAST_PREDICTOR_HORIZON_DAYS || '14',
				FORECAST_PREDICTOR_MAX_LIFE_DAYS:
					process.env.FORECAST_PREDICTOR_MAX_LIFE_DAYS || '7',
			},
			initialPolicy: [lambdaPolicy],
		});
		const predictorStep = new LambdaInvoke(this, 'Predictor', {
			lambdaFunction: predictorLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({ requestType: 'CREATE' }),
		});
		const predictorStatusStep = new LambdaInvoke(this, 'Predictor Status', {
			lambdaFunction: predictorLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'STATUS',
				predictorArn: JsonPath.stringAt('$.predictorArn'),
			}),
		});

		// Forecast Lambda
		const forecastLambda = new NodejsFunction(this, 'ForecastLambda', {
			entry: `${lambdaPath}/${lambdaDir}/forecast/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			environment: lambdaEnvironment,
			initialPolicy: [lambdaPolicy],
		});
		const forecastStep = new LambdaInvoke(this, 'Forecast', {
			lambdaFunction: forecastLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'CREATE',
				predictorName: JsonPath.stringAt('$.predictorName'),
				predictorArn: JsonPath.stringAt('$.predictorArn'),
			}),
		});
		const forecastStatusStep = new LambdaInvoke(this, 'Forecast Status', {
			lambdaFunction: forecastLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'STATUS',
				forecastArn: JsonPath.stringAt('$.forecastArn'),
			}),
		});

		// Branches
		const forecastBranch = forecastStep.next(forecastStatusStep).next(
			new Choice(this, 'Forecast Ready?')
				.when(
					Condition.stringEquals('$.forecastStatus', 'ACTIVE'),
					new Succeed(this, 'Success', {
						comment: 'Forecast Creation Succeeded',
					})
				)
				.when(
					Condition.stringMatches('$.forecastStatus', '*_FAILED'),
					new Fail(this, 'Forecast Failure', {
						cause: 'Forecast Creation Failed',
					})
				)
				.otherwise(
					new Wait(this, 'Wait Forecast', {
						time: WaitTime.duration(Duration.minutes(2)),
					}).next(forecastStatusStep)
				)
		);

		const predictorBranch = predictorStep.next(predictorStatusStep).next(
			new Choice(this, 'Predictor Ready?')
				.when(
					Condition.stringEquals('$.predictorStatus', 'ACTIVE'),
					forecastBranch
				)
				.when(
					Condition.stringMatches('$.predictorStatus', '*_FAILED'),
					new Fail(this, 'Predictor Failure', {
						cause: 'Predictor Creation Failed',
					})
				)
				.otherwise(
					new Wait(this, 'Wait Predictor', {
						time: WaitTime.duration(Duration.minutes(2)),
					}).next(predictorStatusStep)
				)
		);

		const importBranch = importStep.next(importStatusStep).next(
			new Choice(this, 'Import Job Ready?')
				.when(
					Condition.stringEquals('$.importJobStatus', 'ACTIVE'),
					predictorBranch
				)
				.when(
					Condition.stringMatches('$.importJobStatus', '*_FAILED'),
					new Fail(this, 'Import Failure', {
						cause: 'Import Job Creation Failed',
					})
				)
				.otherwise(
					new Wait(this, 'Wait Import', {
						time: WaitTime.duration(Duration.minutes(2)),
					}).next(importStatusStep)
				)
		);

		// State Machine definition
		const definition = queuerStep.next(workerStep).next(
			new Choice(this, 'Processed All Items?')
				.when(Condition.numberEquals('$.messagesReceived', 0), importBranch)
				.otherwise(
					new Wait(this, 'Wait', {
						time: WaitTime.secondsPath('$.waitSeconds'),
					}).next(workerStep)
				)
		);

		return new StateMachine(this, 'StateMachine', {
			definition,
			timeout: Duration.hours(6),
		});
	}

	private createLambda(
		s3Bucket: IBucket | undefined,
		lambdaDir: string,
		lambdaEnvironment: Record<string, string>,
		lambdaPolicy: PolicyStatement,
		lambdaTimeout: Duration,
		api: RestApi
	) {
		let lambda: IFunction;
		if (s3Bucket) {
			lambda = new Function(this, lambdaDir, {
				runtime: Runtime.NODEJS_12_X,
				code: Code.fromBucket(s3Bucket, `${lambdaPath}/${lambdaDir}`),
				handler: 'index.handler',
				environment: lambdaEnvironment,
				timeout: lambdaTimeout,
				initialPolicy: [lambdaPolicy],
			});
		} else {
			lambda = new NodejsFunction(this, lambdaDir, {
				entry: `${lambdaPath}/${lambdaDir}/index.ts`,
				handler: 'handler',
				environment: lambdaEnvironment,
				timeout: lambdaTimeout,
				initialPolicy: [lambdaPolicy],
			});
		}

		const lambdaIntegration = new LambdaIntegration(lambda);
		const lambdaResource = api.root.addResource(lambdaDir);
		lambdaResource.addMethod('GET', lambdaIntegration);

		if (LOCAL) {
			new CfnOutput(this, `Endpoint-${lambdaDir}`, {
				value: `http://localhost:4566/restapis/${api.restApiId}/prod/_user_request_${lambdaResource.path}`,
			});
		}
	}

	private log(message?: string, ...optionalParams: unknown[]): void {
		if (!TEST) {
			optionalParams?.length > 0
				? console.info(message, optionalParams)
				: console.info(message);
		}
	}
}
