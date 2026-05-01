const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const env = fs.readFileSync('.env.local', 'utf8').split('\n').reduce((a,l)=>{const [k,...v]=l.split('=');if(k)a[k.trim()]=v.join('=').trim();return a;},{});
const sb = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.VITE_SUPABASE_ANON_KEY);
(async()=>{
  const { data: clients } = await sb.from('clients').select('id,name').ilike('name','%ambica%plastic%');
  console.log('clients:', clients);
  if (!clients || !clients.length) return;
  const cid = clients[0].id;
  const { data: engs } = await sb.from('audit_engagements').select('id,financial_year,is_py_shell,status').eq('client_id', cid);
  console.log('engagements:', engs);
  for (const e of (engs||[])) {
    const { data: groups } = await sb.from('tally_groups').select('group_name,parent_group_name,primary_group,nature,bs_pl_side').eq('engagement_id', e.id);
    const rel = groups.filter(g => /duties|current liabilities|stock/i.test(g.group_name));
    console.log(`\nFY ${e.financial_year} (py_shell=${e.is_py_shell}):`, rel);
    const { data: stockL } = await sb.from('tally_ledgers').select('ledger_name,parent_group_name,opening_balance,closing_balance').eq('engagement_id', e.id).or('ledger_name.ilike.%stock%,parent_group_name.ilike.%stock%').limit(20);
    console.log('  stock-ish ledgers:', stockL);
    const { data: dt } = await sb.from('tally_ledgers').select('ledger_name,parent_group_name,opening_balance,closing_balance').eq('engagement_id', e.id).ilike('parent_group_name','%duties%');
    console.log('  duties & taxes ledgers count:', dt?.length, dt?.slice(0,5));
    const { data: tb } = await sb.from('tally_trial_balance').select('group_name,parent_node_id,node_id,is_group,opening_balance,closing_balance,bs_pl_side,primary_group').eq('engagement_id', e.id).or('group_name.ilike.%duties%,group_name.ilike.%current liab%,group_name.ilike.%stock%');
    console.log('  TB rows of interest:', tb);
  }
})();
