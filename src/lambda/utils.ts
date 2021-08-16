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

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/no-explicit-any -- we don't have a choice ¯\_(ツ)_/¯
export function errorMessage(error: any): string {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
	return error.toString ? error.toString() : JSON.stringify(error);
}
