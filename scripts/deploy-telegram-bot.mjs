/**
 * deploy-telegram-bot.mjs
 * Bundles the telegram-bot Edge Function and deploys via Supabase Management API.
 *
 * Usage:
 *   node scripts/deploy-telegram-bot.mjs <SUPABASE_ACCESS_TOKEN>
 *
 * Get your access token from: https://supabase.com/dashboard/account/tokens
 * (Click "Generate new token" → copy the sbp_xxx... value)
 */

import https from 'https';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_REF = 'hubyywmodekfdzhwiumb';
const FUNCTION_SLUG = 'telegram-bot';

const token = process.argv[2] || process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error('\n❌ Usage: node scripts/deploy-telegram-bot.mjs <SUPABASE_ACCESS_TOKEN>');
  console.error('   Get your token from: https://supabase.com/dashboard/account/tokens\n');
  process.exit(1);
}

async function bundleFunction() {
  const srcPath = path.resolve(__dirname, '../supabase/functions/telegram-bot/index.ts');
  console.log('📦 Bundling', srcPath);
  const result = await esbuild.build({
    entryPoints: [srcPath],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: false,
    write: false,
    external: ['node:*'],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  return result.outputFiles[0].text;
}

function apiCall(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    const options = {
      hostname: 'api.supabase.com',
      path,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

(async () => {
  try {
    const bundled = await bundleFunction();
    console.log(`✓ Bundled (${bundled.length.toLocaleString()} chars)`);

    const payload = { slug: FUNCTION_SLUG, name: FUNCTION_SLUG, verify_jwt: false, body: bundled };

    console.log('🚀 Creating function...');
    let res = await apiCall('POST', `/v1/projects/${PROJECT_REF}/functions`, payload, token);
    console.log('POST', res.status, res.body.substring(0, 150));

    if (res.status === 409) {
      console.log('ℹ Function exists, patching...');
      res = await apiCall('PATCH', `/v1/projects/${PROJECT_REF}/functions/${FUNCTION_SLUG}`,
        { verify_jwt: false, body: bundled }, token);
      console.log('PATCH', res.status, res.body.substring(0, 150));
    }

    if (res.status >= 200 && res.status < 300) {
      console.log('\n✅ telegram-bot deployed successfully!');
      console.log('   URL: https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/telegram-bot\n');
    } else {
      console.error('\n❌ Deployment failed. Status:', res.status);
      console.error(res.body);
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
})();
