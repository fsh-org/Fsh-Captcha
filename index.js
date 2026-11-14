// Packages
const bodyParser = require('body-parser');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const cors = require('cors');

const DB = require('fshdb');
const svgCaptcha = require('svg-captcha');

let nanoid;
(async()=>{
  const nanid = await import('nanoid');
  nanoid = nanid.nanoid;
})();

// Options
const providerKeyLength = 12;
const captchaIDLength = 16;
const captchaExpire = 2 * 60 * 1000; // 2 mins
const verifiedIDLength = 16;
const verifiedExpire = 2 * 60 * 1000; // 2 mins
const cleanupTime = 10 * 60 *1000; // 10 mins
const captchaTextBase = {
  width: 300,
  height: 100,
  noise: 4,
  color: true,
  background: '#181818'
};

// DBs
const providers = new DB('databases/providers.json', { compact: true });
const captchaStore = new Map(); // In memory
const verifiedStore = new Map(); // In memory

setInterval(()=>{
  let now = Date.now();
  [...captchaStore.entries()]
    .forEach(([key, value]) => value.expires<now?captchaStore.delete(key):null);
  [...verifiedStore.entries()]
    .forEach(([key, value]) => value<now?captchaStore.delete(key):null);
}, cleanupTime)

/* Errors */
process.on('uncaughtException', function(err) {
  console.log('Error!');
  console.log(err);
});

/* Utility functions */
function getCookie(req, name) {
  let cookies = req.headers.cookie;
  name += '=';
  cookies = String(cookies)
    .split(' ')
    .filter(cookie => cookie.startsWith(name))[0]
    ?.split(';')[0]
    ?.split('=')[1];
  return cookies ?? '';
}
let tokenCache = {};
async function getUser(req) {
  let cook = getCookie(req, 'FshAccountToken');
  if (!cook) return;
  if (tokenCache[cook]) return tokenCache[cook];
  let res = await fetch('https://account.fsh.plus/api/me', { headers: { cookie: 'FshAccountToken='+cook } });
  if (!res.ok) return;
  res = await res.json();
  tokenCache[cook] = res.id;
  return res.id;
}

// Setup
const PORT = 3005;
const app = express();

app.use(cors());
app.use(bodyParser.json());

// Static resources
app.use('/media', express.static('media'));

// Main pages
app.get('/', async function(req, res) {
  res.sendFile(path.join(__dirname, './pages/index.html'));
});
app.get('/widget.js', async function(req, res) {
  res.sendFile(path.join(__dirname, './pages/widget.js'));
});
app.get('/test', async function(req, res) {
  res.sendFile(path.join(__dirname, './pages/test.html'));
});

app.get('/panel', async function(req, res) {
  if (!await getUser(req)) {
    res.sendFile(path.join(__dirname, './pages/login.html'));
    return;
  }
  let provider = 'catcatcatcat';
  res.send(fs.readFileSync(path.join(__dirname, 'pages', 'panel.html'), 'utf8')
    .replace('{data}', JSON.stringify(providers.get(provider+'.requests'))));
});

// API V1
app.get('/api/v1/captcha', (req, res) => {
  let key = req.query['key'];
  if (!key || (typeof key).toLowerCase()!=='string' || key.length!==providerKeyLength) {
    res.status(400);
    res.json({
      err: true,
      msg: 'Key required'
    });
    return;
  }

  let prov = providers.get(key);
  let site = req.query['site'];
  if (!site) {
    res.status(400);
    res.json({
      err: true,
      msg: 'Site required'
    });
    return;
  }
  if (!prov.domains[site]) {
    res.status(400);
    res.json({
      err: true,
      msg: 'Site / provider missmatch'
    });
    return;
  }

  // Generate
  let method = prov.domains[site];
  const captchaId = nanoid(captchaIDLength);
  let data = { image: '', result: '', input: '' };
  let captcha;
  switch(method.method) {
    case 'text':
      captcha = svgCaptcha.create({
        ...captchaTextBase,
        size: method.length,
        ignoreChars: '0oO1lLI'
      });
      data = { image: captcha.data, result: captcha.text, input: 'text' };
      break;
    case 'math':
      captcha = svgCaptcha.createMathExpr({
        ...captchaTextBase,
        mathMin: method.min,
        mathMax: method.max,
        mathOperator: method.operators
      });
      data = { image: captcha.data, result: captcha.text, input: 'text' };
      break;
  }

  captchaStore.set(captchaId, {
    result: data.result,
    provider: key,
    expires: Date.now() + captchaExpire
  });

  res.json({
    id: captchaId,
    input: data.input,
    image: data.image
  });
});

app.post('/api/v1/verify', (req, res) => {
  let id = req.body['id'];
  let input = req.body['input'];
  if (!id || !input) {
    res.status(400);
    res.json({
      err: true,
      msg: 'invalid body'
    });
    return;
  }

  const stored = captchaStore.get(id);
  if (!stored || Date.now() > stored.expires) {
    res.status(400);
    res.json({
      err: true,
      msg: 'invalid id'
    });
    return;
  }

  const match = stored.result.toLowerCase() === input.toLowerCase();
  providers.push(stored.provider+'.requests', {
    passed: match,
    domain: req.header('origin').replace(/https?:\/\//i,''),
    ua: req.header('user-agent'),
    when: Date.now()
  });
  captchaStore.delete(id);

  if (!match) {
    res.json({ success: false });
    return;
  }

  let verid = nanoid(verifiedIDLength);
  verifiedStore.set(verid, Date.now()+verifiedExpire);

  res.json({ success: true, verid });
});
app.get('/api/v1/check', (req, res) => {
  res.json({ verified: verifiedStore.has(req.query('id')||'') });
});

// 404
app.use(function(req, res) {
  res.status(404);
  res.sendFile(path.join(__dirname, './pages/404.html'));
});

// Listen
app.listen(PORT, ()=>{
  console.log('server running on '+PORT);
});