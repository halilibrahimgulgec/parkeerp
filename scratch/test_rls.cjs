const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://aaxwznaxvjltcskrdtyu.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFheHd6bmF4dmpsdGNza3JkdHl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTE3NDIsImV4cCI6MjA5MjYyNzc0Mn0.26Zs7RJ6iziS0o7OdKE1TGySvPzv3NFZzi4p_mdttzo';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function test() {
  console.log('--- Testing products ---');
  const { data: products, error: pErr } = await supabase.from('products').select('id, name, company_id').limit(5);
  console.log('products count:', products ? products.length : 0, 'error:', pErr);
  if (products) console.log('products:', products);

  console.log('--- Testing shipments ---');
  const { data: shipments, error: sErr } = await supabase.from('shipments').select('id, company_id').limit(5);
  console.log('shipments count:', shipments ? shipments.length : 0, 'error:', sErr);
  if (shipments) console.log('shipments:', shipments);

  console.log('--- Testing production_entries ---');
  const { data: prod, error: prErr } = await supabase.from('production_entries').select('id, company_id').limit(5);
  console.log('production count:', prod ? prod.length : 0, 'error:', prErr);
  if (prod) console.log('production:', prod);
}

test();
