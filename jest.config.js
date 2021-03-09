module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	reporters: ["default", "jest-junit"],
	testTimeout: 100000,
	roots: ["<rootDir>/tests"],
	setupFiles: ["dotenv/config"],
	globals: {
		'ts-jest': {
			tsconfig: 'tsconfig.tests.json'
		}
	}
};