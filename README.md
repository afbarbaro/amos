# Timeseries Forecasting using AWS Forecast

This is a self-contained, fully-reproducible project to forecast time series using serverless Lambda functions with TypeScript, AWS CDK, and Localstack.

## Environment variables

- All environment settings required to execute the production and test commands should be provided stored in the `.env` file.
- An example `.env.example` is provided with dummy values. Copy this file, rename it to `.env` and provide the actual values, corresponding to the actual AWS account, API keys, etc.

## AWS credentials for local unit testing

- Make sure your AWS credentials for the profile specified in the environment variables is also registered in your `~/.aws/credentials` file.

## Useful npm commands

### Build, watch, test

- `npm run build` Compile Typescript to js
- `npm run watch` Watch for changes to Typescript and compile
- `npm run test` Run the Jest unit tests

### Install awscli

- `pip3 install awscli` to install or `pip3 install --upgrade awscli` to upgrade

### Deploy to localstack

- `pip3 install localstack` to install localstack or `pip3 install localstack --upgrade` to upgrade localstack to the latest
- `localstack:start` Start the localhost container
- Check localstack status http://localhost:4566/health
- `npm run cdklocal:bootstrap` Bootstrap the CDK stack to be able to deploy it to localstack
- `npm run cdklocal:deploy` Deploy the stack to localstack
- `localstack:stop` Stop the localhost container

### localstack useful commands

- Bucket commands
  - Check forecast bucket's content
    `aws --endpoint-url=http://localhost:4566 s3 ls --recursive amos-forecast-data`
  - Add file to forecast bucket
    `aws --endpoint-url=http://localhost:4566 s3api put-object --bucket amos-forecast-data --key config/api.config.tiingo.json --body ./config/api.config.tiingo.json`
    `aws --endpoint-url=http://localhost:4566 s3api put-object --bucket amos-forecast-data --key config/api.config.alphavantage.json --body ./config/api.config.alphavantage.json`
- Queue commands
  - Create queue
    `aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url http://localhost:4566/000000000000/amos-queue.fifo`
  - Get queue url
    `aws --endpoint-url=http://localhost:4566 sqs get-queue-url --queue-name amos-queue.fifo`
  - Purge queue
    `aws --endpoint-url=http://localhost:4566 sqs purge-queue --queue-url http://localhost:4566/000000000000/amos-queue.fifo`
  - List queues
    `aws --endpoint-url=http://localhost:4566 sqs list-queues`

### Deploy to AWS

- `npm run cdk:bootstrap` Bootstrap the CDK stack to be able to deploy it to AWS
- `npm run cdk:deploy` Deploy the stack to AWS

### Running local unit testing

- `npm` scripts are provided to run the tests. You can also use the `jest` extension in `vscode` to run tests individually.
- Prerequisite: make sure `localstack` is up and running properly before executing tests. See section `Deploy to localstack` above.

## State machine inputs

To execute the state machine manually, provide input in JSON format. It should be an object with this structure (values can vary, though).

```
{
  "skipQueueing": false,
  "downloadStartDate": "2010-01-01",
  "downloadEndDate": "0d"
}
```

## AWS Forecast resources

- Datasets
  https://github.com/awsdocs/amazon-forecast-developer-guide/blob/main/doc_source/howitworks-datasets-groups.md
  https://github.com/aws-samples/amazon-forecast-samples/blob/master/notebooks/basic/Tutorial/1.Getting_Data_Ready.ipynb

## CDK resources

- Custom Resources
  https://github.com/aws/aws-cdk/tree/master/packages/%40aws-cdk/custom-resources
  https://github.com/aws/aws-cdk/blob/master/packages/%40aws-cdk/custom-resources/test/provider-framework/integration-test-fixtures/s3-file-handler/index.ts

## Credits and useful references

This repository expands on several original ideas and guidance provided by these blog post and accompanying repositories.

- https://dev.to/_mikigraf/localstack-cdk-local-aws-development-58ff
  - https://github.com/mikigraf/CDK-with-Localstack
- https://dev.to/martzcodes/dynamodb-lambdas-and-api-gw-with-localstack-or-not-4bm8#lambdas
  - https://github.com/martzcodes/blog-cdk-localstack/blob/master/lib/blog-cdk-localstack-stack.ts
