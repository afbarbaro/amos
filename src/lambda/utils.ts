import { APIGatewayProxyResult } from 'aws-lambda';

export type SuccessResult<T> = {
	success: true;
	data?: T;
};

export type ErrorResult = {
	success: false;
	message: string;
};

export type Result<T> = SuccessResult<T> | ErrorResult;

export async function gatewayResult<T>(
	result: Promise<Result<T>>
): Promise<APIGatewayProxyResult> {
	const o = await result;
	return {
		statusCode: o.success ? 200 : 200,
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(o.success ? o.data : o),
	};
}
