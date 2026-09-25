/**
 * Built-in ticker knowledge used by the parser.
 *
 * NAME_ALIASES: what you might type -> ticker (or a list of tickers when it's
 * ambiguous and the bot should ask). Your own aliases live in the Settings tab
 * and take priority over these.
 *
 * Any ticker NOT listed here still works - the bot checks it against
 * Google Finance before logging.
 */
var NAME_ALIASES = {
  // Big tech
  'apple': 'AAPL', 'microsoft': 'MSFT', 'msft': 'MSFT',
  'google': ['GOOGL', 'GOOG'], 'alphabet': ['GOOGL', 'GOOG'],
  'amazon': 'AMZN', 'meta': 'META', 'facebook': 'META', 'fb': 'META',
  'nvidia': 'NVDA', 'tesla': 'TSLA', 'netflix': 'NFLX',
  // Semis
  'amd': 'AMD', 'intel': 'INTC', 'broadcom': 'AVGO', 'tsmc': 'TSM', 'taiwan semi': 'TSM',
  'qualcomm': 'QCOM', 'micron': 'MU', 'arm': 'ARM', 'asml': 'ASML',
  'supermicro': 'SMCI', 'super micro': 'SMCI', 'marvell': 'MRVL',
  'texas instruments': 'TXN', 'applied materials': 'AMAT', 'lam research': 'LRCX',
  // Software / internet
  'palantir': 'PLTR', 'salesforce': 'CRM', 'oracle': 'ORCL', 'adobe': 'ADBE', 'ibm': 'IBM',
  'snowflake': 'SNOW', 'crowdstrike': 'CRWD', 'palo alto': 'PANW', 'cloudflare': 'NET',
  'datadog': 'DDOG', 'shopify': 'SHOP', 'uber': 'UBER', 'airbnb': 'ABNB',
  'spotify': 'SPOT', 'snapchat': 'SNAP', 'pinterest': 'PINS', 'reddit': 'RDDT',
  'roblox': 'RBLX', 'zoom': 'ZM', 'docusign': 'DOCU', 'servicenow': 'NOW',
  'applovin': 'APP', 'dell': 'DELL', 'duolingo': 'DUOL', 'unity': 'U',
  // Fintech / crypto
  'coinbase': 'COIN', 'microstrategy': 'MSTR', 'strategy': 'MSTR', 'robinhood': 'HOOD',
  'sofi': 'SOFI', 'paypal': 'PYPL', 'visa': 'V', 'mastercard': 'MA',
  'block': 'XYZ', 'square': 'XYZ', 'affirm': 'AFRM',
  // Finance
  'berkshire': 'BRK.B', 'jpmorgan': 'JPM', 'jp morgan': 'JPM', 'bank of america': 'BAC',
  'goldman': 'GS', 'goldman sachs': 'GS', 'morgan stanley': 'MS', 'amex': 'AXP',
  'american express': 'AXP',
  // Consumer
  'disney': 'DIS', 'nike': 'NKE', 'costco': 'COST', 'walmart': 'WMT', 'coca cola': 'KO',
  'cocacola': 'KO', 'coke': 'KO', 'pepsi': 'PEP', 'pepsico': 'PEP', 'mcdonalds': 'MCD',
  'starbucks': 'SBUX', 'home depot': 'HD', 'target': 'TGT', 'lululemon': 'LULU',
  'chipotle': 'CMG', 'ford': 'F', 'general motors': 'GM', 'rivian': 'RIVN', 'lucid': 'LCID',
  // China / Asia ADRs
  'alibaba': 'BABA', 'pdd': 'PDD', 'temu': 'PDD', 'pinduoduo': 'PDD', 'nio': 'NIO',
  'grab holdings': 'GRAB', 'sea': 'SE', 'shopee': 'SE', 'jd': 'JD',
  // Healthcare
  'eli lilly': 'LLY', 'lilly': 'LLY', 'novo': 'NVO', 'novo nordisk': 'NVO',
  'pfizer': 'PFE', 'moderna': 'MRNA', 'unitedhealth': 'UNH', 'johnson and johnson': 'JNJ',
  // Energy / industrial / telco
  'exxon': 'XOM', 'chevron': 'CVX', 'boeing': 'BA', 'lockheed': 'LMT', 'caterpillar': 'CAT',
  'verizon': 'VZ', 'att': 'T', 'at&t': 'T',
  // Quantum etc.
  'ionq': 'IONQ', 'rigetti': 'RGTI',
  // ETFs
  's&p': ['VOO', 'SPY', 'IVV'], 'sp500': ['VOO', 'SPY', 'IVV'], 's&p500': ['VOO', 'SPY', 'IVV'],
  'nasdaq': ['QQQ', 'QQQM']
};

/**
 * Singapore (SGX) names -> SGX stock codes. These are priced in SGD via Yahoo Finance.
 * Any other SGX code also works: type it (e.g. "C38U") or add "sgx"/"sgd" to your message.
 */
var SGX_ALIASES = {
  'dbs': 'D05', 'ocbc': 'O39', 'uob': 'U11', 'singtel': 'Z74', 'sia': 'C6L',
  'singapore airlines': 'C6L', 'capitaland': '9CI', 'capitaland investment': '9CI',
  'keppel': 'BN4', 'sats': 'S58', 'genting singapore': 'G13', 'st engineering': 'S63',
  'stengg': 'S63', 'wilmar': 'F34', 'thaibev': 'Y92', 'thai bev': 'Y92', 'sembcorp': 'U96',
  'frasers logistics': 'BUOU', 'flct': 'BUOU', 'clar': 'A17U', 'capitaland ascendas': 'A17U',
  'mapletree industrial': 'ME8U', 'mapletree logistics': 'M44U', 'mapletree pan asia': 'N2IU',
  'mpact': 'N2IU', 'cict': 'C38U', 'capitaland integrated': 'C38U', 'sti etf': 'ES3',
  'yangzijiang': 'BS6', 'yzj': 'BS6', 'hongkong land': 'H78', 'jardine': 'J36',
  'jardine matheson': 'J36', 'keppel dc': 'AJBU', 'frasers centrepoint': 'J69U', 'fct': 'J69U',
  'suntec': 'T82U', 'suntec reit': 'T82U', 'city developments': 'C09', 'cdl': 'C09', 'uol': 'U14',
  'comfortdelgro': 'C52', 'sheng siong': 'OV8', 'ifast': 'AIY', 'sgx group': 'S68',
  'venture corp': 'V03', 'parkwaylife': 'C2PU', 'parkway life': 'C2PU', 'cromwell': 'CWBU',
  'digital core': 'DCRU', 'ntt reit': 'NTDU', 'lendlease reit': 'JYEU', 'cdl reit': 'J85',
  'far east hospitality': 'Q5T', 'seatrium': '5E2', 'yzj financial': 'YF8'
};
/** SGX codes that should default to SGD. */
var SGX_TICKERS = (function () {
  var s = {};
  Object.keys(SGX_ALIASES).forEach(function (k) { s[SGX_ALIASES[k]] = true; });
  ['D05', 'O39', 'U11', 'Z74', 'C6L', 'S68', 'ES3', 'G3B', 'CLR', 'A35', 'O87', 'SRT',
    'K71U', 'CJLU', 'AU8U', 'HMN', 'M1GU', 'OXMU', 'P40U', 'BTOU', 'TS0U', 'SK6U', 'D5IU',
    'C61U', 'JYEU', 'ACV', 'Q0X', 'BVA', 'V01', 'E5H', 'F9D', 'H02', 'U09', 'EB5', 'S7OU']
    .forEach(function (t) { s[t] = true; });
  return s;
})();

/** Extra tickers recognised on sight (on top of every ticker in NAME_ALIASES). */
var EXTRA_TICKERS = [
  'SPY', 'VOO', 'IVV', 'QQQ', 'QQQM', 'VTI', 'VT', 'SCHD', 'VGT', 'SMH', 'SOXX', 'SOXL',
  'TQQQ', 'SQQQ', 'ARKK', 'IWM', 'DIA', 'GLD', 'SLV', 'TLT', 'JEPI', 'JEPQ', 'VXUS',
  'BRK.A', 'GOOG', 'GOOGL', 'HIMS', 'OKLO', 'RKLB', 'ASTS', 'TSM', 'AVGO', 'ANET', 'MELI',
  'CELH', 'ENPH', 'PLUG', 'NKE', 'WBD', 'PARA', 'CMCSA', 'TMUS', 'LOW', 'ABBV', 'MRK',
  'CVS', 'WFC', 'C', 'SCHW', 'BLK', 'KO', 'PG', 'UNP', 'DE', 'MMM', 'GE', 'HON', 'RTX',
  'NOC', 'GD', 'INTU', 'ADSK', 'TEAM', 'MDB', 'ZS', 'OKTA', 'TWLO', 'ETSY', 'EBAY',
  'ROKU', 'DKNG', 'CHWY', 'W', 'PATH', 'AI', 'SOUN', 'BBAI', 'MARA', 'RIOT', 'CLSK',
  'HPQ', 'CSCO', 'TXN', 'ADI', 'NXPI', 'ON', 'WOLF', 'LI', 'XPEV', 'BIDU', 'TCEHY'
];

/**
 * Everyday words that are ALSO real tickers (ON, IT, ALL, NOW...).
 * These only count as a ticker when you type them in CAPITALS or with a $,
 * e.g. "bought 3 ON" or "bought 3 $on".
 */
var COMMON_WORD_TICKERS = [
  'on', 'it', 'all', 'a', 'now', 'be', 'has', 'can', 'are', 'so', 'key', 'low', 'big',
  'fun', 'well', 'good', 'true', 'u', 'w', 'c', 'ai', 'net', 'app', 'path', 'open', 'fast',
  'safe', 'love', 'real', 'kind', 'more', 'most', 'just', 'go', 'hear', 'see', 'you',
  'grab', 'low', 'li', 'de', 'pg', 'c'
];
