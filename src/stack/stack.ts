import { ForecastDatasetResource } from './forecast/forecast';
import { LambdaIntegration, RestApi } from '@aws-cdk/aws-apigateway';
import { PolicyStatement } from '@aws-cdk/aws-iam';
import { Code, Function, Runtime } from '@aws-cdk/aws-lambda';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Bucket } from '@aws-cdk/aws-s3';
import * as cdk from '@aws-cdk/core';
import { CfnOutput } from '@aws-cdk/core';
import { readdirSync } from 'fs';
import * as path from 'path';

const TEST = process.env.NODE_ENV === 'test';
const LOCAL = process.env.npm_lifecycle_event!.includes('cdklocal') || TEST;
const USE_NODEJS_FUNCTION = process.env.USE_NODEJS_FUNCTION == 'true';

const srcPath = path.resolve(__dirname, '..');
const codePath = USE_NODEJS_FUNCTION
	? srcPath
	: srcPath.replace('/src', '/dist');
const lambdaPath = path.resolve(codePath, 'lambda');

export class AmosStack extends cdk.Stack {
	constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
		super(scope, id, props);

		// Forecast
		new ForecastDatasetResource(this, 'amos', {
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
		readdirSync(lambdaPath).forEach((lambdaDir) => {
			this.log(`Configuring Lambda ${lambdaDir}`);

			let lambda;
			if (USE_NODEJS_FUNCTION) {
				lambda = new NodejsFunction(this, lambdaDir, {
					entry: `${lambdaPath}/${lambdaDir}/index.ts`,
					handler: 'handler',
					environment: { RAPIDAPI_KEY: process.env.RAPIDAPI_KEY || '' },
					initialPolicy: [
						new PolicyStatement({
							resources: ['*'],
							actions: ['forecast:*', 'iam:listRoles'],
						}),
					],
				});
			} else {
				lambda = new Function(this, lambdaDir, {
					runtime: Runtime.NODEJS_12_X,
					code: s3Bucket
						? Code.fromBucket(s3Bucket, `${lambdaPath}/${lambdaDir}`)
						: Code.fromAsset(`${lambdaPath}/${lambdaDir}`),
					handler: 'index.handler',
					environment: { RAPIDAPI_KEY: process.env.RAPIDAPI_KEY || '' },
					initialPolicy: [
						new PolicyStatement({
							resources: ['*'],
							actions: ['forecast:*', 'iam:listRoles'],
						}),
					],
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
