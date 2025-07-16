// Packages
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const htms = require('server-htms');

const DB = require('fshdb');
const svgCaptcha = require('svg-captcha');

let nanoid;
(async()=>{
  const nanid = await import('nanoid');
  nanoid = nanid.nanoid;
})();

// Options
const providerKeyLength = 10;
const captchaIDLength = 12;
const captchaExpire = 2 * 60 * 1000; // 2 mins
const captchaGoodExpire = 5 * 60 * 1000; // 5 mins
const captchaTextBackground = '#181818';
const cleanupTime = 10 * 60 *1000; // 10 mins

// DBs
const providers = new DB('databases/providers.json', { compact: true });
const captchaStore = new Map(); // In memory
const captchaGoodStore = new Map(); // In memory

setInterval(()=>{
  let now = Date.now();
  [...captchaStore.entries()]
    .filter(([key, value]) => value.expires<now)
    .forEach(([key, value]) => captchaStore.delete(key));
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
app.use(htms);

// Static resources
app.use('/media', express.static('media'));

// Main pages
app.get('/', async function(req, res) {
  res.htms('pages/index.html');
});

app.get('/panel', async function(req, res) {
  if (!await getUser(req)) {
    res.htms('pages/login.html');
  } else {
    res.htms('pages/panel.html');
  }
});
app.get('/tpanel', async function(req, res) {
  res.htms('pages/panel.html');
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

  // Get method
  let method = prov.method;
  let site = req.query['site'];
  if (site) {
    try {
      site = new URL(site);
      site = prov.override[site.hostname];
      if (site) method = site;
    } catch(err) {
      // Ignore
    }
  }

  // Generate
  const captchaId = nanoid(captchaIDLength);
  let data = { image: '', result: '', input: '' };
  let captcha;
  switch(method) {
    case 'text':
      captcha = svgCaptcha.create({
        size: 6,
        noise: 4,
        color: true,
        background: captchaTextBackground,
        ignoreChars: '0oO1ilI'
      });
      data = { image: captcha.data, result: captcha.text, input: 'text' };
      break;
    case 'math':
      captcha = svgCaptcha.createMathExpr({
        mathMin: 1,
        mathMax: 20,
        mathOperator: '+-',
        noise: 4,
        color: true,
        background: captchaTextBackground
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
  let id;
  let input;
  try {
    id = req.body['id'];
    input = req.body['input'];
  } catch(err) {
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
  providers.set(stored.provider+'.'+(match?'good':'bad'), providers.get(stored.provider+'.'+(match?'good':'bad'))+1)
  captchaStore.delete(id);

  if (match) captchaGoodStore.set(id, Date.now()+captchaGoodExpire);

  res.json({ success: match });
});

app.get('/api/v1/check', (req, res) => {
  const id = req.query['id'];
  const stored = captchaGoodStore.get(id);

  res.json({ success: !!stored });
});

// 404
app.use(function(req, res) {
  res.status(404);
  res.htms('pages/404.html');
});

// Listen
app.listen(PORT, ()=>{
  console.log('server running on '+PORT);
});