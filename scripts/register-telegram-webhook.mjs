/**
 * register-telegram-webhook.mjs
 * Registers the Supabase Edge Function URL as the Telegram bot webhook.
 *
 * Usage:
 *   node scripts/register-telegram-webhook.mjs <TELEGRAM_BOT_TOKEN>
 *
 * Example:
 *   node scripts/register-telegram-webhook.mjs 1234567890:AAFxxxYYY
 */

import https from 'https';

const BOT_TOKEN = process.argv[2] || process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error('\n❌ Usage: node scripts/register-telegram-webhook.mjs <TELEGRAM_BOT_TOKEN>');
  console.error('   Get your token from @BotFather on Telegram\n');
  process.exit(1);
}

const WEBHOOK_URL = 'https://hubyywmodekfdzhwiumb.supabase.co/functions/v1/telegram-bot';

function tgApi(method, params = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${BOT_TOKEN}/${method}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  // 1. Get bot info
  console.log('🔍 Verifying bot token...');
  const me = await tgApi('getMe');
  if (!me.ok) {
    console.error('❌ Invalid bot token:', JSON.stringify(me));
    process.exit(1);
  }
  console.log(`✓ Bot: @${me.result.username} (${me.result.first_name})`);

  // 2. Delete any old webhook
  console.log('🗑  Removing old webhook...');
  await tgApi('deleteWebhook');

  // 3. Set new webhook
  console.log(`🔗 Setting webhook to:\n   ${WEBHOOK_URL}`);
  const res = await tgApi('setWebhook', {
    url: WEBHOOK_URL,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });

  if (res.ok) {
    console.log('\n✅ Webhook registered successfully!');
    console.log('   Send a message to your bot on Telegram to test it.');
    console.log('\n📋 Bot details:');
    console.log('   Name:', me.result.first_name);
    console.log('   Username: @' + me.result.username);
    console.log('   ID:', me.result.id);
  } else {
    console.error('❌ Webhook registration failed:', JSON.stringify(res, null, 2));
  }

  // 4. Verify webhook info
  const info = await tgApi('getWebhookInfo');
  console.log('\n📡 Webhook status:', JSON.stringify(info.result, null, 2));
})();
