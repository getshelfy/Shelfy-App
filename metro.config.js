const { getDefaultConfig } = require('expo/metro-config');
const { FileStore } = require('metro-cache');
const path = require('path');
const fs = require('fs');

const config = getDefaultConfig(__dirname);

config.resolver.unstable_enablePackageExports = true;

// Use turborepo to restore the cache when possible
config.cacheStores = [
    new FileStore({ root: path.join(__dirname, 'node_modules', '.cache', 'metro') }),
  ];

// Custom server middleware to receive console.log messages from the app
const LOG_FILE_PATH = path.join(__dirname, '.natively', 'app_console.log');
const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5MB

// Ensure log directory exists
const logDir = path.dirname(LOG_FILE_PATH);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

config.server = config.server || {};
config.server.enhanceMiddleware = (middleware) => {
  return (req, res, next) => {

    // DEBUG: log all metro bundle requests
    if (req.url.includes('index.bundle') || req.url.includes('.bundle')) {
      console.log('[METRO] Request:', req.method, req.url);
    }

    // Extract pathname without query params for matching
    const pathname = req.url.split('?')[0];

    // Handle log receiving endpoint
    if (pathname === '/natively-logs' && req.method === 'POST') {
      console.log('[NATIVELY-LOGS] Received POST request');
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        try {
          const logData = JSON.parse(body);
          const timestamp = logData.timestamp || new Date().toISOString();
          const level = (logData.level || 'log').toUpperCase();
          const message = logData.message || '';
          const source = logData.source || '';
          const platform = logData.platform || '';

          const platformInfo = platform ? `[${platform}] ` : '';
          const sourceInfo = source ? `[${source}] ` : '';
          const logLine = `[${timestamp}] ${platformInfo}[${level}] ${sourceInfo}${message}\n`;

          console.log('[NATIVELY-LOGS] Writing log:', logLine.trim());

          // Rotate log file if too large
          try {
            if (fs.existsSync(LOG_FILE_PATH) && fs.statSync(LOG_FILE_PATH).size > MAX_LOG_SIZE) {
              const content = fs.readFileSync(LOG_FILE_PATH, 'utf8');
              const lines = content.split('\n');
              fs.writeFileSync(LOG_FILE_PATH, lines.slice(lines.length / 2).join('\n'));
            }
          } catch (e) {
            // Ignore rotation errors
          }

          fs.appendFileSync(LOG_FILE_PATH, logLine);

          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end('{"status":"ok"}');
        } catch (e) {
          console.error('[NATIVELY-LOGS] Error processing log:', e.message);
          res.writeHead(500, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          });
          res.end(JSON.stringify({ error: e.message }));
        }
      });
      return;
    }

    // Handle CORS preflight for log endpoint
    if (pathname === '/natively-logs' && req.method === 'OPTIONS') {
      console.log('[NATIVELY-LOGS] Received OPTIONS preflight request');
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
      });
      res.end();
      return;
    }

    // For bundle requests, intercept Metro's error responses.
    // Metro returns compilation errors as application/json (HTTP 500),
    // which browsers refuse to execute as a <script>. We rewrite the
    // response as executable JS that renders the error in the page.
    if (req.url && req.url.includes('.bundle') && req.method === 'GET') {
      const originalWriteHead = res.writeHead.bind(res);
      const originalEnd = res.end.bind(res);
      let interceptedStatus = null;
      let interceptedContentType = null;

      res.writeHead = (status, ...args) => {
        interceptedStatus = status;
        const headers = args[0];
        if (headers) {
          const ct = typeof headers === 'object' ? (headers['Content-Type'] || headers['content-type']) : null;
          if (ct) interceptedContentType = ct;
        }
        // Don't send headers yet if this is a JSON error — we'll rewrite it
        if (status >= 400 && interceptedContentType && interceptedContentType.includes('application/json')) {
          return res;
        }
        return originalWriteHead(status, ...args);
      };

      res.end = (body, ...args) => {
        if (interceptedStatus >= 400 && interceptedContentType && interceptedContentType.includes('application/json')) {
          // Metro returned a JSON error for a bundle request.
          // Rewrite as executable JS that displays the error using safe DOM methods.
          let errorMessage = 'Build error';
          let errorName = 'SyntaxError';
          let sourceFile = '';
          try {
            const parsed = JSON.parse(body);
            const raw = parsed.message || parsed.errors?.[0]?.message || JSON.stringify(parsed, null, 2);
            // Strip ANSI escape codes (terminal colors)
            const ANSI_RE = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
            errorMessage = raw.replace(ANSI_RE, '');
            const nameMatch = errorMessage.match(/^(\w+Error):/);
            if (nameMatch) errorName = nameMatch[1];
            const fileMatch = errorMessage.match(/\/expo-project\/([^:]+)/);
            if (fileMatch) sourceFile = fileMatch[1];
          } catch {}

          const escapedMessage = JSON.stringify(errorMessage);
          const escapedName = JSON.stringify(errorName);
          const escapedSource = JSON.stringify(sourceFile);

          const errorScript = `
(function() {
  var root = document.getElementById('root');
  if (!root) return;

  var BG = '#1a1a1a';
  var BG_LIGHT = '#2a2a2a';
  var RED = '#f35369';

  // Fill background to prevent white edges
  document.documentElement.style.background = BG;
  document.body.style.background = BG;
  document.body.style.margin = '0';
  root.style.background = BG;

  // Root container
  var container = document.createElement('div');
  container.style.cssText = 'display:flex;flex:1;flex-direction:column;background:' + BG + ';height:100%';

  // Red header
  var header = document.createElement('div');
  header.style.cssText = 'background:' + RED + ';padding:8px 12px;text-align:center';
  var headerText = document.createElement('span');
  headerText.style.cssText = 'color:white;font-size:13px;font-weight:600;font-family:system-ui,sans-serif';
  headerText.textContent = 'Build Error';
  header.appendChild(headerText);

  // Scrollable body
  var scrollBody = document.createElement('div');
  scrollBody.style.cssText = 'flex:1;overflow:auto;padding-bottom:16px';

  // Error name + message
  var msgSection = document.createElement('div');
  msgSection.style.cssText = 'padding:14px 12px';
  var nameEl = document.createElement('div');
  nameEl.style.cssText = 'color:' + RED + ';font-size:18px;font-weight:700;margin-bottom:8px;font-family:system-ui,sans-serif';
  nameEl.textContent = ${escapedName};
  var msgEl = document.createElement('div');
  msgEl.style.cssText = 'color:white;font-size:13px;font-weight:400;line-height:18px;font-family:system-ui,sans-serif';
  msgEl.textContent = ${escapedMessage}.split('\\n')[0];
  msgSection.appendChild(nameEl);
  msgSection.appendChild(msgEl);
  scrollBody.appendChild(msgSection);

  // Source section
  if (${escapedSource}) {
    var srcSection = document.createElement('div');
    srcSection.style.cssText = 'margin:0 12px 12px';
    var srcTitle = document.createElement('div');
    srcTitle.style.cssText = 'color:rgba(255,255,255,0.45);font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;font-family:system-ui,sans-serif';
    srcTitle.textContent = 'Source';
    var srcCard = document.createElement('div');
    srcCard.style.cssText = 'background:' + BG_LIGHT + ';border-radius:6px;overflow:hidden';
    var srcRow = document.createElement('div');
    srcRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;padding:8px 10px';
    var srcLabel = document.createElement('span');
    srcLabel.style.cssText = 'color:rgba(255,255,255,0.5);font-size:12px;font-weight:500;font-family:system-ui,sans-serif';
    srcLabel.textContent = 'File';
    var srcValue = document.createElement('span');
    srcValue.style.cssText = 'color:white;font-size:11px;font-family:monospace;font-weight:600';
    srcValue.textContent = ${escapedSource};
    srcRow.appendChild(srcLabel);
    srcRow.appendChild(srcValue);
    srcCard.appendChild(srcRow);
    srcSection.appendChild(srcTitle);
    srcSection.appendChild(srcCard);
    scrollBody.appendChild(srcSection);
  }

  // Full error details
  var detailSection = document.createElement('div');
  detailSection.style.cssText = 'margin:0 12px 12px';
  var detailTitle = document.createElement('div');
  detailTitle.style.cssText = 'color:rgba(255,255,255,0.45);font-size:11px;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:6px;font-family:system-ui,sans-serif';
  detailTitle.textContent = 'Details';
  var detailCard = document.createElement('pre');
  detailCard.style.cssText = 'margin:0;background:rgba(0,0,0,0.25);border-radius:6px;padding:10px;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:16px;font-family:monospace;color:rgba(255,255,255,0.4);max-height:180px;overflow:auto';
  detailCard.textContent = ${escapedMessage};
  detailSection.appendChild(detailTitle);
  detailSection.appendChild(detailCard);
  scrollBody.appendChild(detailSection);

  // Footer with retry button
  var footer = document.createElement('div');
  footer.style.cssText = 'background:' + BG + ';border-top:1px solid rgba(255,255,255,0.08);padding:10px 12px';
  var retryBtn = document.createElement('button');
  retryBtn.style.cssText = 'width:100%;background:' + BG_LIGHT + ';border:none;border-radius:8px;padding:10px;cursor:pointer;color:rgba(255,255,255,0.85);font-size:13px;font-weight:600;font-family:system-ui,sans-serif';
  retryBtn.textContent = 'Retry';
  retryBtn.onmouseover = function() { retryBtn.style.background = '#3a3a3a'; };
  retryBtn.onmouseout = function() { retryBtn.style.background = BG_LIGHT; };
  retryBtn.onclick = function() { window.location.reload(); };
  footer.appendChild(retryBtn);

  container.appendChild(header);
  container.appendChild(scrollBody);
  container.appendChild(footer);
  root.appendChild(container);

  console.error('[Metro] ' + ${escapedMessage});

  // Auto-reload when the compile error is fixed.
  // Poll the bundle URL — when it returns 200, the error is resolved.
  var bundleUrl = window.location.origin + '/index.ts.bundle?platform=web&dev=true';
  var pollTimer = setInterval(function() {
    fetch(bundleUrl, { method: 'HEAD' })
      .then(function(res) {
        if (res.ok) {
          clearInterval(pollTimer);
          window.location.reload();
        }
      })
      .catch(function() {});
  }, 5000);
})();
`;
          originalWriteHead(200, { 'Content-Type': 'application/javascript; charset=UTF-8' });
          return originalEnd(errorScript, ...args);
        }
        return originalEnd(body, ...args);
      };
    }

    // Pass through to default Metro middleware
    return middleware(req, res, next);
  };
};

module.exports = config;
