import { downloadMeta, providerConfigurations } from '../../api/api';
import type { ApiFileConfig, ApiProvider, SymbolMeta } from '../../api/types';
import { readFileSync, writeFileSync } from 'fs';

const readSymbolsConfig = (provider: ApiProvider) => {
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const data: ApiFileConfig = JSON.parse(
		readFileSync(
			`${__dirname}/../../../config/api.config.${provider}.json`
		).toString()
	);

	return data;
};

export const downloadAndWriteMeta = async (): Promise<
	Record<ApiProvider, Record<string, SymbolMeta[]>>
> => {
	const results: Record<string, Record<string, SymbolMeta[]>> = {};
	for (const providerConfiguration of providerConfigurations) {
		const provider = providerConfiguration.provider;
		results[provider] = {};

		// read configuration
		const symbolsConfigFile = readSymbolsConfig(provider);

		for (const [key, call] of Object.entries(
			providerConfiguration.calls.meta
		)) {
			const symbolsConfig = symbolsConfigFile[key];
			if (symbolsConfig) {
				// download symbols meta
				const meta = await Promise.all(
					symbolsConfig.symbols.map((symbol) => downloadMeta(symbol, call))
				);
				results[provider][key] = meta;

				// write
				writeFileSync(
					`${__dirname}/../../../config/symbols.${key}.${provider}.json`,
					JSON.stringify(meta, null, 2)
				);
			}
		}
	}

	return results;
};
