/**
 * Dynamic asset-class derivation for the COT universe.
 *
 * Rules are keyword patterns applied to the CFTC market name, ordered from
 * most specific to least. They were tuned against the full universe of
 * markets present in the 2024-2026 Legacy Combined archives so that every
 * market lands in one of the six product classes the workspace documents;
 * the single multi-asset index future with no natural home (BBG COMMODITY)
 * is labelled "Other" rather than forced into a wrong bucket.
 *
 * This function runs at ingestion time only; the panel stores the result.
 */

const RULES: Array<[string, RegExp]> = [
  ["FX", /DOLLAR|YEN|EURO FX|POUND|BRAZILIAN REAL|MEXICAN PESO|XIU|WON|RUPEE|RUBLE|FRANC|FX\/|RAND|RENMINBI/i],
  [
    "Equity indices",
    /S&P|NASDAQ|\bDOW\b|RUSSELL|NIKKEI|MSCI|VIX|STOXX|FTSE|DAX|CAC 40|HANG SENG|KOSPI|ASX|TSX|IBOVESPA|\bIPC\b|DJIA|REAL ESTATE IDX|GROWTH|VALUE INDEX|TOP 50|STOCK INDEX|EQUITY/i,
  ],
  [
    "Interest rates",
    /FED FUNDS|SOFR|ERIS|BOND|NOTE\b|YIELD|GILT|BUND|BOBL|SCHATZ|SHORT TERM RATE|EURIBOR|STERLING|INT RATE|US TREASURY|T-BOND|T-NOTE|ULTRA|CREDIT|DURATION-HEDGED/i,
  ],
  [
    "Metals",
    /GOLD|SILVER|COPPER|ALUMIN|PLATIN|PALLAD|NICKEL|ZINC|\bLEAD\b|IRON|STEEL|FERROUS|COBALT|LITHIUM|URANIUM|\bTIN\b|HRC|BUSHELING|MWP/i,
  ],
  [
    "Crypto",
    /BITCOIN|ETHER|\bSOL\b|XRP|DOGECOIN|SHIB|AVALANCHE|CHAINLINK|LITECOIN|HEDERA|CARDONA|COINBASE|LMX LABS/i,
  ],
  [
    "Energy",
    /CRUDE|\bOIL|GASOLINE|HEATING OIL|\bGAS\b|NAT GAS|PROPANE|BUTANE|ETHANE|ETHYLENE|PROPYLENE|RBOB|BRENT|WTI|HENRY HUB|ERCOT|CAISO|PJM|MISO|ISONE|NYISO|REC\b|RECS|CARBON|\bRIN|ETHANOL|COAL|POWER|ELECTRIC|ULSD|DIESEL|SULFUR|ARGUS|OPIS|CONWAY|AECO|ALGONQUIN|DOMINION|MALIN|MICHCON|\bCIG\b|BASIS|INDEX|HUB|CITYGATE|CITYGATES|FUEL|JET|WCS|HOUSTON|SHIP CHANNEL|DAYTON|SAN JUAN|ROCKIES|MAINLINE|FLORIDA|TRANSCO|COLUMBIA|TETCO|KERN|SOCAL|WAHA|EMISSIONS|OFFSET|NATURE GLOBAL|COMPLIANCE REC|SOLAR|DAY-AHEAD|DA PEAK|DA OFF|MID-C|PALO VERDE|RGGI|SONAT|SP15|GREEN-E|HSFO|NAPHTHA|GASOIL|KERO|BELVIEU|USGC|PLATTS|PGP|\bAECs?\b|PENNSYLVANIA/i,
  ],
  [
    "Agriculture",
    /CORN|WHEAT|SOY|COTTON|COCOA|COFFEE|SUGAR|ORANGE|LIVE CATTLE|FEEDER|HOG|LUMBER|MILK|BUTTER|CHEESE|CANOLA|RICE|\bOATS\b|MEAL|\bOJ\b|CASH SETTLED|CASH-SETTLED|FRZN|WHEY|UREA/i,
  ],
];

export function classifyAssetClass(marketName: string): string {
  for (const [cls, pattern] of RULES) {
    if (pattern.test(marketName)) return cls;
  }
  return "Other";
}
