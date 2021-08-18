import { ForecastDatasetResource } from './forecast/forecast';
import { LambdaIntegration, RestApi } from '@aws-cdk/aws-apigateway';
import { Rule, RuleTargetInput, Schedule } from '@aws-cdk/aws-events';
import { SfnStateMachine } from '@aws-cdk/aws-events-targets';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Code, Function, IFunction, Runtime } from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Bucket, IBucket } from '@aws-cdk/aws-s3';
import { BucketDeployment, Source } from '@aws-cdk/aws-s3-deployment';
import { Queue } from '@aws-cdk/aws-sqs';
import {
	Choice,
	Condition,
	Fail,
	IStateMachine,
	JsonPath,
	StateMachine,
	Succeed,
	TaskInput,
	Wait,
	WaitTime,
} from '@aws-cdk/aws-stepfunctions';

import {
	LambdaInvoke,
	StepFunctionsStartExecution,
} from '@aws-cdk/aws-stepfunctions-tasks';
import * as cdk from '@aws-cdk/core';
import { CfnOutput, Duration } from '@aws-cdk/core';
import { readdirSync } from 'fs';
import * as path from 'path';
import { resolve } from 'path';

const TEST = process.env.NODE_ENV === 'test';
const LOCAL = process.env.npm_lifecycle_event!.includes('cdklocal') || TEST;

const srcPath = path.resolve(__dirname, '..');
const codePath = LOCAL ? srcPath.replace('/src', '/dist') : srcPath;
const lambdaPath = path.resolve(codePath, 'lambda');

function env(value: string | undefined, defaultValue = '') {
	return value || defaultValue;
}

export class AmosStack extends cdk.Stack {
	constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// Forecast custom resource
		const forecast = new ForecastDatasetResource(this, `${id}-forecast`, {
			local: LOCAL,
		});

		// API configuration files
		if (!LOCAL) {
			new BucketDeployment(this, 'Config Files', {
				sources: [Source.asset(path.resolve(__dirname, '../../config'))],
				destinationKeyPrefix: 'config/',
				destinationBucket: forecast.bucket,
			});
		}

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
				's3:listBucket',
				's3:getObject',
				's3:putObject',
				'sqs:getQueueAttributes',
				'sqs:sendMessage*',
				'sqs:receiveMessage',
				'sqs:deleteMessage*',
				'iam:PassRole',
			],
		});
		const lambdaEnvironment = {
			FORECAST_ROLE_ARN: forecast.assumeRoleArn,
			FORECAST_BUCKET_NAME: forecast.bucket.bucketName,
			FORECAST_DATASET_PREFIX: forecast.node.id.replace('-', '_'),
			FORECAST_DATASET_ARN: forecast.datasetArn,
			FORECAST_DATASET_GROUP_ARN: forecast.datasetGroupArn,
		};

		readdirSync(lambdaPath, { withFileTypes: true }).forEach((lambdaDir) => {
			if (lambdaDir.isDirectory()) {
				this.log(`Configuring Lambda ${lambdaDir.name}`);

				if (lambdaDir.name === 'dataset') {
					this.createStateMachines(
						lambdaDir.name,
						lambdaPolicy,
						lambdaEnvironment,
						Duration.seconds(60),
						128
					);
				} else {
					const path = resolve(lambdaPath, lambdaDir.name);
					readdirSync(path, { withFileTypes: true }).forEach((subDir) => {
						if (subDir.isDirectory()) {
							this.createLambda(
								s3Bucket,
								subDir.name,
								path,
								lambdaEnvironment,
								lambdaPolicy,
								Duration.seconds(45),
								256,
								api
							);
						}
					});
				}
			}
		});
	}

	private createStateMachines(
		lambdaDir: string,
		lambdaPolicy: PolicyStatement,
		lambdaEnvironment: Record<string, string>,
		lambdaTimeout: Duration,
		lambdaMemory: number
	) {
		const forecastStateMachine = this.createForecastStateMachine(
			lambdaDir,
			lambdaPolicy,
			lambdaEnvironment,
			lambdaTimeout,
			lambdaMemory
		);

		this.createDatasetStateMachine(
			lambdaDir,
			lambdaPolicy,
			lambdaEnvironment,
			lambdaTimeout,
			lambdaMemory,
			forecastStateMachine
		);
	}

	private createDatasetStateMachine(
		lambdaDir: string,
		lambdaPolicy: PolicyStatement,
		lambdaEnvironment: Record<string, string>,
		lambdaTimeout: Duration,
		lambdaMemory: number,
		forecastStateMachine?: IStateMachine
	) {
		// SQS Queue
		const queue = new Queue(this, 'Queue', {
			queueName: `${this.artifactId}-queue`,
		});

		// Exit if running a local CDK (State machines are not supported yet)
		if (LOCAL) {
			return;
		}

		// Queuer Lambda
		const queuerLambda = new NodejsFunction(this, 'QueuerLambda', {
			entry: `${lambdaPath}/${lambdaDir}/queuer/index.ts`,
			handler: 'handler',
			runtime: Runtime.NODEJS_14_X,
			timeout: lambdaTimeout,
			memorySize: lambdaMemory,
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
			runtime: Runtime.NODEJS_14_X,
			timeout: lambdaTimeout,
			memorySize: lambdaMemory,
			environment: {
				...lambdaEnvironment,
				RAPIDAPI_KEY: env(process.env.RAPIDAPI_KEY),
				TIINGO_API_KEY: env(process.env.TIINGO_API_KEY),
				DATASET_API_DOWNLOAD_START_DATE: env(
					process.env.DATASET_API_DOWNLOAD_START_DATE,
					'-15year'
				),
				DATASET_API_DOWNLOAD_END_DATE: env(
					process.env.DATASET_API_DOWNLOAD_END_DATE,
					'0day'
				),
				DATASET_API_MAX_CALLS_PER_MINUTE: env(
					process.env.DATASET_API_MAX_CALLS_PER_MINUTE,
					'1'
				),
			},
			initialPolicy: [lambdaPolicy],
		});
		const workerStep = new LambdaInvoke(this, 'Worker', {
			lambdaFunction: workerLambda,
			payloadResponseOnly: true,
		});

		const success = new Succeed(this, 'Success', {
			comment: 'Dataset Process Succeeded',
		});

		const executeForecast = forecastStateMachine
			? new StepFunctionsStartExecution(this, 'Execute Forecast', {
					stateMachine: forecastStateMachine,
					input: TaskInput.fromObject({
						import: { enabled: true },
						predictor: { enabled: true },
						forecast: { enabled: true },
						export: { enabled: true },
						analyze: { enabled: true, rebuild: false },
					}),
					// eslint-disable-next-line no-mixed-spaces-and-tabs -- there's a glitch between prettier and eslint here ¯\_(ツ)_/¯
			  })
			: undefined;

		// State Machine definition
		const definition = queuerStep.next(workerStep).next(
			new Choice(this, 'Processed All Items?')
				.when(
					Condition.numberEquals('$.workedMessages', 0),
					executeForecast ? executeForecast.next(success) : success
				)
				.otherwise(
					new Wait(this, 'Wait', {
						time: WaitTime.secondsPath('$.waitSeconds'),
					}).next(workerStep)
				)
		);

		const stateMachine = new StateMachine(this, 'Dataset State Machine', {
			definition,
			timeout: Duration.hours(2),
		});

		this.createDatasetDailyRunEventRule(stateMachine, {
			skipQueueing: false,
			downloadStartDate: process.env.DATASET_API_DOWNLOAD_START_DATE,
			downloadEndDate: '0d',
		});
	}

	private createForecastStateMachine(
		lambdaDir: string,
		lambdaPolicy: PolicyStatement,
		lambdaEnvironment: Record<string, string>,
		lambdaTimeout: Duration,
		lambdaMemory: number
	) {
		// Exit if running a local CDK (State machines are not supported yet)
		if (LOCAL) {
			return;
		}

		// Import Lambda
		const importLambda = new NodejsFunction(this, 'ImportLambda', {
			entry: `${lambdaPath}/${lambdaDir}/import/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			memorySize: lambdaMemory,
			environment: lambdaEnvironment,
			initialPolicy: [lambdaPolicy],
		});
		const importStep = new LambdaInvoke(this, 'Import', {
			lambdaFunction: importLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'CREATE',
				enabled: JsonPath.stringAt('$.import.enabled'),
			}),
			resultPath: '$.import.results',
		});
		const importStatusStep = new LambdaInvoke(this, 'Import Status', {
			lambdaFunction: importLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'STATUS',
				enabled: JsonPath.stringAt('$.import.enabled'),
				importJobArn: JsonPath.stringAt('$.import.results.importJobArn'),
			}),
			resultPath: '$.import.results',
		});

		// Predictor Lambda
		const predictorLambda = new NodejsFunction(this, 'PredictorLambda', {
			entry: `${lambdaPath}/${lambdaDir}/predictor/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			memorySize: lambdaMemory,
			environment: {
				...lambdaEnvironment,
				FORECAST_PREDICTOR_ALGORITHM_ARN: env(
					process.env.FORECAST_PREDICTOR_ALGORITHM_ARN
				),
				FORECAST_PREDICTOR_PERFORM_HPO: env(
					process.env.FORECAST_PREDICTOR_PERFORM_HPO,
					'false'
				),
				FORECAST_PREDICTOR_HORIZON_DAYS: env(
					process.env.FORECAST_PREDICTOR_HORIZON_DAYS,
					'31'
				),
				FORECAST_PREDICTOR_MAX_LIFE_DAYS: env(
					process.env.FORECAST_PREDICTOR_MAX_LIFE_DAYS,
					'7'
				),
			},
			initialPolicy: [lambdaPolicy],
		});
		const predictorStep = new LambdaInvoke(this, 'Predictor', {
			lambdaFunction: predictorLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'CREATE',
				enabled: JsonPath.stringAt('$.predictor.enabled'),
			}),
			resultPath: '$.predictor.results',
		});
		const predictorStatusStep = new LambdaInvoke(this, 'Predictor Status', {
			lambdaFunction: predictorLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'STATUS',
				predictorArn: JsonPath.stringAt('$.predictor.results.predictorArn'),
			}),
			resultPath: '$.predictor.results',
		});

		// Forecast Lambda
		const forecastLambda = new NodejsFunction(this, 'ForecastLambda', {
			entry: `${lambdaPath}/${lambdaDir}/forecast/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			memorySize: lambdaMemory,
			environment: lambdaEnvironment,
			initialPolicy: [lambdaPolicy],
		});
		const forecastStep = new LambdaInvoke(this, 'Forecast', {
			lambdaFunction: forecastLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'CREATE',
				enabled: JsonPath.stringAt('$.forecast.enabled'),
				predictorName: JsonPath.stringAt('$.predictor.results.predictorName'),
				predictorArn: JsonPath.stringAt('$.predictor.results.predictorArn'),
			}),
			resultPath: '$.forecast.results',
		});
		const forecastStatusStep = new LambdaInvoke(this, 'Forecast Status', {
			lambdaFunction: forecastLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'STATUS',
				forecastName: JsonPath.stringAt('$.forecast.results.forecastName'),
				forecastArn: JsonPath.stringAt('$.forecast.results.forecastArn'),
			}),
			resultPath: '$.forecast.results',
		});

		// Export Lambda
		const exportLambda = new NodejsFunction(this, 'ExportLambda', {
			entry: `${lambdaPath}/${lambdaDir}/export/index.ts`,
			handler: 'handler',
			timeout: lambdaTimeout,
			memorySize: lambdaMemory,
			environment: lambdaEnvironment,
			initialPolicy: [lambdaPolicy],
		});
		const exportStep = new LambdaInvoke(this, 'Export', {
			lambdaFunction: exportLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'CREATE',
				enabled: JsonPath.stringAt('$.export.enabled'),
				forecastName: JsonPath.stringAt('$.forecast.results.forecastName'),
				forecastArn: JsonPath.stringAt('$.forecast.results.forecastArn'),
			}),
			resultPath: '$.export.results',
		});
		const exportStatusStep = new LambdaInvoke(this, 'Export Status', {
			lambdaFunction: exportLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				requestType: 'STATUS',
				enabled: JsonPath.stringAt('$.export.enabled'),
				exportArn: JsonPath.stringAt('$.export.results.exportArn'),
			}),
			resultPath: '$.export.results',
		});

		// Analyze Lambda
		const analyzeLambda = new NodejsFunction(this, 'AnalyzeLambda', {
			entry: `${lambdaPath}/${lambdaDir}/analyze/index.ts`,
			handler: 'handler',
			timeout: Duration.minutes(lambdaTimeout.toMinutes() * 2), // 2x the normal duration
			memorySize: lambdaMemory * 2, // 2x the normal memory size
			environment: lambdaEnvironment,
			initialPolicy: [lambdaPolicy],
		});
		const analyzeStep = new LambdaInvoke(this, 'Analyze', {
			lambdaFunction: analyzeLambda,
			payloadResponseOnly: true,
			payload: TaskInput.fromObject({
				enabled: JsonPath.stringAt('$.analyze.enabled'),
				rebuild: JsonPath.stringAt('$.analyze.rebuild'),
				forecastName: JsonPath.stringAt('$.forecast.results.forecastName'),
			}),
			resultPath: '$.analyze.results',
		});

		// Branches
		const exportBranch = exportStep.next(exportStatusStep).next(
			new Choice(this, 'Export Ready?')
				.when(
					Condition.stringEquals('$.export.results.exportStatus', 'ACTIVE'),
					analyzeStep
				)
				.when(
					Condition.stringMatches('$.export.results.exportStatus', '*_FAILED'),
					new Fail(this, 'Export Failure', {
						cause: 'Export Creation Failed',
					})
				)
				.otherwise(
					new Wait(this, 'Wait Export', {
						time: WaitTime.duration(Duration.minutes(5)),
					}).next(exportStatusStep)
				)
		);

		const forecastBranch = forecastStep.next(forecastStatusStep).next(
			new Choice(this, 'Forecast Ready?')
				.when(
					Condition.stringEquals('$.forecast.results.forecastStatus', 'ACTIVE'),
					exportBranch
				)
				.when(
					Condition.stringMatches(
						'$.forecast.results.forecastStatus',
						'*_FAILED'
					),
					new Fail(this, 'Forecast Failure', {
						cause: 'Forecast Creation Failed',
					})
				)
				.otherwise(
					new Wait(this, 'Wait Forecast', {
						time: WaitTime.duration(Duration.minutes(5)),
					}).next(forecastStatusStep)
				)
		);

		const predictorBranch = predictorStep.next(predictorStatusStep).next(
			new Choice(this, 'Predictor Ready?')
				.when(
					Condition.stringEquals(
						'$.predictor.results.predictorStatus',
						'ACTIVE'
					),
					forecastBranch
				)
				.when(
					Condition.stringMatches(
						'$.predictor.results.predictorStatus',
						'*_FAILED'
					),
					new Fail(this, 'Predictor Failure', {
						cause: 'Predictor Creation Failed',
					})
				)
				.otherwise(
					new Wait(this, 'Wait Predictor', {
						time: WaitTime.duration(Duration.minutes(10)),
					}).next(predictorStatusStep)
				)
		);

		// State Machine definition
		const definition = importStep.next(importStatusStep).next(
			new Choice(this, 'Import Job Ready?')
				.when(
					Condition.stringEquals('$.import.results.importJobStatus', 'ACTIVE'),
					predictorBranch
				)
				.when(
					Condition.stringMatches(
						'$.import.results.importJobStatus',
						'*_FAILED'
					),
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

		return new StateMachine(this, 'Forecast State Machine', {
			definition,
			timeout: Duration.hours(6),
		});
	}

	private createLambda(
		s3Bucket: IBucket | undefined,
		dir: string,
		path: string,
		environment: Record<string, string>,
		policy: PolicyStatement,
		timeout: Duration,
		memorySize: number,
		api: RestApi
	) {
		let lambda: IFunction;
		if (s3Bucket) {
			lambda = new Function(this, dir, {
				runtime: Runtime.NODEJS_14_X,
				code: Code.fromBucket(s3Bucket, `${path}/${dir}`),
				handler: 'index.handler',
				environment: environment,
				timeout: timeout,
				memorySize: memorySize,
				initialPolicy: [policy],
			});
		} else {
			lambda = new NodejsFunction(this, dir, {
				runtime: Runtime.NODEJS_14_X,
				entry: `${path}/${dir}/index.ts`,
				handler: 'handler',
				environment: environment,
				timeout: timeout,
				memorySize: memorySize,
				initialPolicy: [policy],
			});
		}

		const lambdaIntegration = new LambdaIntegration(lambda);
		const lambdaResource = api.root.addResource(dir);
		lambdaResource.addMethod('GET', lambdaIntegration);

		if (LOCAL) {
			new CfnOutput(this, `Endpoint-${dir}`, {
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

	private createDatasetDailyRunEventRule(
		stateMachine: IStateMachine,
		input: Record<string, unknown>
	) {
		new Rule(this, 'Dataset Daily Run', {
			ruleName: 'Dataset_Daily_Run',
			schedule: Schedule.cron({ minute: '0', hour: '22' }),
			targets: [
				new SfnStateMachine(stateMachine, {
					input: RuleTargetInput.fromObject(input),
				}),
			],
		});
	}
}
