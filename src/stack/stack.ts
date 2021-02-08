import { ForecastDatasetResource } from './forecast/forecast';
import { LambdaIntegration, RestApi } from '@aws-cdk/aws-apigateway';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Code, Function, IFunction, Runtime } from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Bucket } from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import { CfnOutput } from '@aws-cdk/core';
import { readdirSync } from 'fs';
import * as path from 'path';

const TEST = process.env.NODE_ENV === 'test';
const LOCAL = process.env.npm_lifecycle_event!.includes('cdklocal') || TEST;

const srcPath = path.resolve(__dirname, '..');
const codePath = LOCAL ? srcPath.replace('/src', '/dist') : srcPath;
const lambdaPath = path.resolve(codePath, 'lambda');

export class AmosStack extends cdk.Stack {
	constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// Forecast
		const forecast = new ForecastDatasetResource(this, 'amos', {
			datasetSuffix: 'crypto',
			bucketName: 'amos-forecast-data',
		});

		// Create API Gateway
		const api = new RestApi(this, 'amos-api', {});

		// Create Bucket for localstack Lambda functions code
		const s3Bucket = LOCAL
			? Bucket.fromBucketName(this, 'LocalStackBucket', '__local__')
			: undefined;

		// Create Lambda Functions
		const lambdaPolicy = new PolicyStatement({
			resources: ['*'],
			actions: ['forecast:*', 's3:getObject', 's3:putObject'],
		});
		const lambdaEnvironment = {
			RAPIDAPI_KEY: process.env.RAPIDAPI_KEY || '',
			FORECAST_ROLE_ARN: forecast.assumeRoleArn,
		};

		readdirSync(lambdaPath).forEach((lambdaDir) => {
			this.log(`Configuring Lambda ${lambdaDir}`);

			let lambda: IFunction;
			if (s3Bucket) {
				lambda = new Function(this, lambdaDir, {
					runtime: Runtime.NODEJS_12_X,
					code: Code.fromBucket(s3Bucket, `${lambdaPath}/${lambdaDir}`),
					handler: 'index.handler',
					environment: lambdaEnvironment,
					initialPolicy: [lambdaPolicy],
				});
			} else {
				lambda = new NodejsFunction(this, lambdaDir, {
					entry: `${lambdaPath}/${lambdaDir}/index.ts`,
					handler: 'handler',
					environment: lambdaEnvironment,
					initialPolicy: [],
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
		});
	}

	private log(message?: string, ...optionalParams: unknown[]): void {
		if (!TEST) {
			optionalParams?.length > 0
				? console.info(message, optionalParams)
				: console.info(message);
		}
	}
}
