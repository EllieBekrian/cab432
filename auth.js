const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { loadConfig } = require('./config.js');

// اگر کانفیگ Cognito نبود یا خطا داد، میریم روی حالت توسعه (DEV)
let useDevAuth = false;
let verifierPromise = null;

async function initializeConfig() {
  try {
    const cfg = await loadConfig();

    if (!cfg.cognitoUserPoolId || !cfg.cognitoClientId) {
      console.warn('Cognito config missing; enabling DEV auth mode for local run.');
      useDevAuth = true;
      return;
    }

    // اگر مقادیر Cognito هست، Verifier بساز (روی EC2 با IAM Role کار می‌کند)
    verifierPromise = CognitoJwtVerifier.create({
      userPoolId: cfg.cognitoUserPoolId,
      tokenUse: 'access',
      clientId: cfg.cognitoClientId,
    });

    console.log('Auth initialized with Cognito configuration.');
  } catch (err) {
    console.error('Failed to initialize config:', err);
    // برای اجرای محلی نذار کرش کنه
    useDevAuth = true;
  }
}

initializeConfig().catch((e) => {
  console.error('initializeConfig error:', e);
  useDevAuth = true;
});

// Middleware: احراز هویت
async function authenticateToken(req, res, next) {
  // حالت توسعه: بدون Cognito
  if (useDevAuth) {
    const username = req.cookies?.username || 'devuser';
    const role = process.env.DEV_ROLE || 'admin'; // اگر خواستی فقط user باشه، بذار 'user'
    req.user = { username, role };
    return next();
  }

  // حالت واقعی: از توکن کوکی یا Authorization Header
  const bearer = req.headers['authorization'];
  const headerToken = bearer && bearer.startsWith('Bearer ') ? bearer.slice(7) : null;
  const token = req.cookies?.token || headerToken;

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const verifier = await verifierPromise;
    const payload = await verifier.verify(token);

    const username =
      payload.username || payload['cognito:username'] || payload.sub || 'unknown';
    const groups = payload['cognito:groups'] || [];
    const role = groups.includes('admin') ? 'admin' : 'user';

    req.user = { username, role };
    next();
  } catch (err) {
    console.error('Token verification failed:', err);
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

// Middleware: مجوز ادمین
function authorizeAdmin(req, res, next) {
  if (req.user?.role === 'admin') return next();
  return res.status(403).json({ error: 'Admin only' });
}

module.exports = { authenticateToken, authorizeAdmin };
