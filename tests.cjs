const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const main = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split('<script>')[1].split('</script>')[0];
const helpers = fs.readFileSync(path.join(root, 'improvements.js'), 'utf8').split('const filterMarkup =')[0];
function setup(initial = {}, sessionUser = null) {
 const storage = new Map(Object.entries(initial));
 const elements = new Map();
 const element = id => {
  if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { add(){}, remove(){}, toggle(){}, contains(){return false;} }, querySelector(){return null;}, querySelectorAll(){return [];}, setAttribute(){}, addEventListener(){}, closest(){return this;}, focus(){} });
  return elements.get(id);
 };
 let inserts = 0;
 let authListener;
 const realtimeHandlers = [];
 const queryFilters = [];
 const query = {select(){return this;},eq(){return this;},gt(){return this;},in(){return this;},or(filter){queryFilters.push(filter);return this;},order(){return this;},limit(){return this;},maybeSingle:async()=>({data:null}),single:async()=>({data:{id:'new'}}),insert(){inserts++;return this;},upsert:async()=>({error:null}),then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};
 const client = {
  auth: { getSession: async () => ({data:{session:sessionUser ? {user:sessionUser} : null}}), getUser:async()=>({data:{user:sessionUser}}),onAuthStateChange(callback){authListener=callback;}, signUp: async()=>({data:{user:{id:'unconfirmed'},session:null}}) },
  from: () => query,
  removeChannel(){},
  channel(){return {on(_event,_filter,callback){realtimeHandlers.push(callback);return this;},subscribe(){return this;}}}

 };
 const context = vm.createContext({ URL, console, Date, setTimeout(){}, clearTimeout(){}, setInterval(){}, clearInterval(){}, window:{supabase:{createClient:()=>client}}, localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}, document:{addEventListener(){},getElementById:element, querySelector:()=>null, querySelectorAll:()=>[], activeElement:null} });
 vm.runInContext(main+'\n'+helpers,context);
 return {run:code=>vm.runInContext(code,context), element, storage, client, insertCount:()=>inserts, realtimeHandlers, queryFilters, authCallback:()=>authListener};
}
test('live app initializes and loads the catalogue', async()=> {
 const s=setup(); await s.run('initNestFind()'); assert.equal(s.run('catalogState'),'ready');
});
test('cached identity cannot create a session',async()=> {
 const s=setup({nf_user:JSON.stringify({id:'fake-user'})}); await s.run('initNestFind()'); assert.equal(s.run('currentUser'),null);
});
test('invalid browser storage does not crash account initialization',()=> {
 const s=setup({nf_state_v2_guest:'{invalid json'}); s.run('loadAccountState()'); assert.equal(s.run('favorites.length'),0);
});
test('account change isolates saved properties and private drafts',()=> {
 const s=setup(); s.run('currentUser={id:"alice"};loadAccountState();favorites=["alice-property"];conversations=[{id:1}];saveState();currentUser={id:"bob"};loadAccountState()'); assert.equal(s.run('favorites.length'),0); assert.equal(s.run('conversations.length'),0); s.run('currentUser={id:"alice"};loadAccountState()'); assert.equal(s.run('favorites[0]'),'alice-property');
});
test('UUID listing handlers produce valid JavaScript and load the listing',()=> {
 const s=setup(); s.run('allProperties=[dbPropertyToApp({id:"8c51b5c1-29c4-4125-8f61-e933f8a3c3a6",title:"Home"})]');
 const html=s.run('propCardHTML(allProperties[0])');
 const encoded=html.match(/onclick=(['"])(.*?)\1/)[2];
 const decoded=encoded.replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&');
 new vm.Script(decoded); s.run(decoded); assert.equal(s.run('currentPropertyId'),'8c51b5c1-29c4-4125-8f61-e933f8a3c3a6');
});
test('property markup escapes injected tags and rejects unsafe image URLs',()=> {
 const s=setup(); s.run(`allProperties=[dbPropertyToApp({id:'x',title:'<img src=x onerror=alert(1)>',description:'<script>alert(1)</script>',photos:['javascript:alert(1)']})]`);
 const html=s.run('propCardHTML(allProperties[0])'); assert.ok(!html.includes('<img src=x')); assert.ok(!html.includes('javascript:')); s.run('openProperty("x")'); assert.ok(!s.element('detail-body').innerHTML.includes('<script>'));
});
test('filters combine budget, bedrooms, property type and period',()=> {
 const s=setup(); const result=s.run(`filterProperties([{price:500,beds:2,propType:'Apartment',period:'year'},{price:500,beds:3,propType:'Apartment',period:'month'},{price:1500,beds:3,propType:'Apartment',period:'year'}],{min:'100',max:'1000',beds:'2',propertyType:'Apartment',period:'year'})`); assert.equal(result.length,1); assert.equal(result[0].period,'year');
});
test('purchase listings never display annual pricing',()=> {
 const s=setup(); assert.equal(s.run('dbPropertyToApp({listing_type:"sale",price:100}).period'),'sale');
});
test('unconfirmed signup does not authenticate or publish a profile',async()=> {
 const s=setup(); s.run('authMode="signup"'); s.element('auth-email').value='test@example.com'; s.element('auth-password').value='testpassword'; s.element('auth-name').value='Test'; await s.run('handleAuth({preventDefault(){}})'); assert.equal(s.run('currentUser'),null);
});
test('negative price is rejected before database insertion',async()=> {
 const s=setup(); s.run('currentUser={id:"test"}'); for(const [key,val] of Object.entries({'add-title':'Home','add-desc':'A home','add-location':'Lagos','add-price':'-2'})) s.element(key).value=val; await s.run('publishListing()'); assert.equal(s.insertCount(),0); assert.match(s.element('toast').textContent,/positive price/);
});
test('past viewing cannot be saved',async()=> {
 const s=setup({}, {id:'test'}); s.run('currentUser={id:"test"};allProperties=[dbPropertyToApp({id:"x"})];currentPropertyId="x"'); s.element('viewing-date').value='2000-01-01';s.element('viewing-time').value='14:00'; await s.run('submitViewing()'); assert.equal(s.run('viewings.length'),0);
});
test('catalog uses database records without injecting sample listings',async()=> {
 const s=setup(); await s.run('loadSupabaseProperties()'); assert.equal(s.run('allProperties.length'),0); assert.equal(s.run('userListings.length'),0);
});

test('all live business workflows remain available',()=> {
 const s=setup(); for(const fn of ['sendMessage','submitViewing','updateViewingStatus','uploadSelectedMedia','compressVideoForNestFind','publishListingAfterPayment','submitTrustReport','resendOtp','sendSupportMessage']) assert.equal(s.run('typeof '+fn),'function',fn);
});
test('incoming realtime message updates conversation without a ReferenceError',async()=> {
 const s=setup(); s.run('currentUser={id:"receiver"};startRealtimeMessages()'); await s.realtimeHandlers[0]({new:{id:'m1',property_id:'p1',sender_id:'sender',receiver_id:'receiver',content:'Hello',created_at:new Date().toISOString()}}); assert.equal(s.run('conversations[0].lastMessage'),'Hello'); assert.equal(s.run('chatMessages[conversations[0].id][0].text'),'Hello');
});
test('stale realtime events are ignored after switching accounts',async()=> {
 const s=setup(); s.run('currentUser={id:"alice"};startRealtimeMessages();currentUser={id:"bob"};loadAccountState()'); await s.realtimeHandlers[0]({new:{id:'m1',property_id:'p1',sender_id:'sender',receiver_id:'alice',content:'Private'}}); assert.equal(s.run('conversations.length'),0);
});
test('auth event callback returns synchronously',async()=> {
 const s=setup(); await s.run('initNestFind()'); const result=s.authCallback()('SIGNED_IN',{user:{id:'test'}}); assert.equal(result,undefined);
});
test('legacy cached premium value cannot grant membership',()=> {
 const s=setup({nf_premium_until:String(Date.now()+86400000)}); s.run('currentUser={id:"test"};loadAccountState()'); assert.equal(s.run('isPremiumMember()'),false);
});
