@echo off
title CAFlow Tally Sync — Check Configuration
color 0B
cd /d "%~dp0"

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║    CAFlow Tally Sync — Current Configuration     ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  Reading your .env settings...
echo.

node -e "
require('dotenv').config();
const c = {
  'Tally Host'      : process.env.TALLY_HOST || 'localhost',
  'Tally Port'      : process.env.TALLY_PORT || '9000',
  'Tally Company'   : process.env.TALLY_COMPANY || '(ACTIVE company in Tally — whichever is open)',
  'Period From'     : process.env.FROM_DATE   || 'NOT SET',
  'Period To'       : process.env.TO_DATE     || 'NOT SET',
  'Financial Year'  : process.env.FINANCIAL_YEAR || 'NOT SET',
  'Firm ID'         : process.env.FIRM_ID     || 'NOT SET',
  'Client ID'       : process.env.CLIENT_ID   || 'NOT SET',
  'Engagement ID'   : process.env.ENGAGEMENT_ID || 'NOT SET',
  'Supabase URL'    : process.env.SUPABASE_URL || 'NOT SET',
  'Service Key'     : process.env.SUPABASE_SERVICE_KEY ? '(set — ' + process.env.SUPABASE_SERVICE_KEY.slice(0,20) + '...)' : 'NOT SET',
  'Auto-Sync Every' : (process.env.SYNC_INTERVAL_MINUTES || '30') + ' minutes',
};
Object.entries(c).forEach(([k,v]) => {
  const pad = k.padEnd(18);
  console.log('  ' + pad + ' : ' + v);
});
console.log('');
"

echo.
echo  If any value shows NOT SET, edit your .env file before running sync.
echo.
pause
