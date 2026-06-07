const SYMBOL_MAP = {
  SOXL: 'SOXL',
  TECL: 'TECL',
  MRVL: 'MRVL',
  QQQ: 'QQQ',
  SMH: 'SMH',
  SOXX: 'SOXX',
  NVDA: 'NVDA',
  USDJPY: 'USDJPY'
};

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchYahooQuote(symbol) {
  const yahooSymbol = SYMBOL_MAP[symbol];
  if (!yahooSymbol) return null;
  if (symbol === 'USDJPY') return fetchFxQuote();
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`;
  const proxied = `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
  let payload;
  try {
    const direct = await fetchWithTimeout(target, {
      headers: { 'user-agent': 'quant-guard/1.0' }
    }, 3500);
    if (!direct.ok) throw new Error(`direct quote failed for ${symbol}`);
    payload = await direct.json();
  } catch (err) {
    const response = await fetchWithTimeout(proxied, {
      headers: { 'user-agent': 'quant-guard/1.0' }
    }, 9000);
    if (!response.ok) throw new Error(`quote fetch failed for ${symbol}`);
    payload = await response.json();
  }
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta || {};
  const close = result?.indicators?.quote?.[0]?.close?.at(-1);
  const price = Number(meta.regularMarketPrice || close);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    symbol,
    price,
    updatedAt: new Date().toISOString(),
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : '',
    source: 'yahoo'
  };
}

async function fetchFxQuote() {
  const response = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD', {
    headers: { 'user-agent': 'quant-guard/1.0' }
  });
  if (!response.ok) throw new Error('fx fetch failed for USDJPY');
  const payload = await response.json();
  const price = Number(payload?.rates?.JPY);
  if (!Number.isFinite(price) || price <= 0) return null;
  return {
    symbol: 'USDJPY',
    price,
    updatedAt: new Date().toISOString(),
    marketTime: payload.time_last_update_utc || '',
    source: 'exchange-rate-api'
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
  const raw = String(req.query.symbols || 'SOXL,TECL,MRVL,QQQ,SMH,SOXX,NVDA,USDJPY');
  const symbols = raw
    .split(',')
    .map(symbol => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 16);

  const settled = await Promise.allSettled(symbols.map(fetchYahooQuote));
  const quotes = settled
    .filter(result => result.status === 'fulfilled' && result.value)
    .map(result => result.value);
  const errors = settled
    .filter(result => result.status === 'rejected')
    .map(result => result.reason?.message || 'quote error');

  res.status(200).json({
    updatedAt: new Date().toISOString(),
    quotes,
    errors
  });
};
