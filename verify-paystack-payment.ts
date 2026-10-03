import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

// Deploy as the existing verify-paystack-payment Edge Function.
// Secrets stay in Supabase; never place them in the website or this file.
function expectedPrice(purpose, plan) {
  if (purpose === 'messaging' && plan == null) return 200000;
  if (purpose === 'listing' && plan == null) return 1000000;
  if (purpose === 'premium' && plan === 'monthly') return 1000000;
  if (purpose === 'premium' && plan === 'yearly') return 12000000;
  throw new Error('Invalid payment purpose or plan.');
}
function validatePayment(payment, user, reference, purpose, plan, mode) {
  const price = expectedPrice(purpose, plan);
  if (payment?.status !== 'success' || payment.reference !== reference ||
      payment.currency !== 'NGN' || Number(payment.amount) !== price || payment.domain !== mode) {
    throw new Error('Payment status, amount or mode did not match.');
  }
  if (!user.email || String(payment.customer?.email || '').trim().toLowerCase() !== user.email.trim().toLowerCase() ||
      payment.metadata?.user_id !== user.id || payment.metadata?.purpose !== purpose ||
      (purpose === 'premium' && payment.metadata?.plan !== plan)) {
    throw new Error('Payment does not match this account and purchase.');
  }
  return price;
}
Deno.serve(async (req) => {
  const origin = req.headers.get('origin') || '';
  const allowed = (Deno.env.get('APP_ORIGINS') || 'https://emmaokoro028-coder.github.io,http://127.0.0.1:8765').split(',').map(x => x.trim());
  const headers = {'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json', 'Vary': 'Origin'};
  const reply = (body, status = 200) => new Response(JSON.stringify(body), {status, headers});
  if (req.method === 'OPTIONS') return new Response(null, {headers});
  if (req.method !== 'POST') return reply({verified:false, message:'Method not allowed.'},405);
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
    const mode = Deno.env.get('PAYMENTS_MODE') || 'live';
    if (!url || !serviceKey || !secret || !['live','test'].includes(mode) || !secret.startsWith(`sk_${mode}_`)) {
      return reply({verified:false, message:'Payment verification is not configured. Keep your payment reference and contact support.'},503);
    }
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i,'');
    if (!token) return reply({verified:false, message:'Sign-in required.'},401);
    const admin = createClient(url,serviceKey,{auth:{persistSession:false}});
    const {data:{user},error:userError} = await admin.auth.getUser(token);
    if (userError || !user) return reply({verified:false,message:'Your session expired. Sign in and retry verification.'},401);
    const {reference,purpose,plan=null} = await req.json();
    if (typeof reference !== 'string' || !/^[A-Za-z0-9._=-]{1,200}$/.test(reference)) throw new Error('Invalid payment reference.');
    expectedPrice(purpose,plan); // Never trust a browser-supplied expected_amount.
    const response = await fetch('https://api.paystack.co/transaction/verify/'+encodeURIComponent(reference),{
      headers:{Authorization:`Bearer ${secret}`}, signal:AbortSignal.timeout(15000)});
    const result = await response.json();
    if (!response.ok || result.status !== true) throw new Error('Payment could not be verified. Keep your reference and retry.');
    const amount = validatePayment(result.data,user,reference,purpose,plan,mode);
    const {data,error} = await admin.rpc('nf_record_verified_payment',{
      p_reference:reference,p_user_id:user.id,p_purpose:purpose,p_plan:plan,p_amount_kobo:amount});
    if (error) return reply({verified:false,message:'Payment received; activation is pending. Keep your reference and retry verification.'},503);
    return reply({...data,verified:true,reference,purpose,plan});
  } catch(error) {
    return reply({verified:false,message:error instanceof Error ? error.message : 'Verification failed. Keep your reference and retry.'},400);
  }
});
