const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
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
  rpc: async () => ({data:null,error:null}),
  from: () => query,
  removeChannel(){},
  channel(){return {on(_event,_filter,callback){realtimeHandlers.push(callback);return this;},subscribe(){return this;}}}

 };
 const context = vm.createContext({ URL, crypto, console, Date, setTimeout(){}, clearTimeout(){}, setInterval(){}, clearInterval(){}, window:{supabase:{createClient:()=>client}}, localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}, document:{addEventListener(){},getElementById:element, querySelector:()=>null, querySelectorAll:()=>[], activeElement:null} });
 vm.runInContext(main+'\n'+helpers,context);
 return {context,run:code=>vm.runInContext(code,context), element, storage, client, insertCount:()=>inserts, realtimeHandlers, queryFilters, authCallback:()=>authListener};
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
test('messaging access comes from the server rather than browser trial dates',async()=>{
 const s=setup();s.run('currentUser={id:"test",created_at:new Date().toISOString()}');
 s.client.rpc=async()=>({data:new Date(Date.now()-1000).toISOString(),error:null});
 assert.equal(await s.run('loadMessageAccessStatus()'),false);
 s.client.rpc=async()=>({data:'infinity',error:null});
 assert.equal(await s.run('loadMessageAccessStatus()'),true);
 assert.equal(s.run('messageAccessUntil'),Infinity);
});
test('trial copy and duration are three days',()=>{
 const s=setup();assert.equal(s.run('MESSAGE_TRIAL_DAYS'),3);
 assert.ok(!fs.readFileSync(path.join(root,'index.html'),'utf8').includes('7-day'));
});
test('a late access response cannot unlock another account',async()=>{
 const s=setup();s.run('currentUser={id:"alice"}');let done;
 s.client.rpc=()=>new Promise(resolve=>done=resolve);
 const request=s.run('loadMessageAccessStatus()');s.run('currentUser={id:"bob"};loadAccountState()');done({data:'infinity',error:null});
 assert.equal(await request,false);assert.equal(s.run('messageAccessUntil'),0);
});
test('pending payment is retried instead of starting a second charge',async()=>{
 const s=setup({'nf_pending_payment_test':JSON.stringify({reference:'saved-reference',purpose:'listing',plan:null})});
 s.run('currentUser={id:"test",email:"test@example.invalid"}');let calls=0;
 s.client.functions={invoke:async()=>{calls++;return {data:{verified:true},error:null};}};
 await s.run('startPaystackPayment("listing",10000)');assert.equal(calls,1);
 assert.match(s.element('toast').textContent,/without paying again/);
 assert.ok(s.storage.has('nf_pending_payment_test'));
});
test('failed verification retains the reference for recovery',async()=>{
 const s=setup({'nf_pending_payment_test':JSON.stringify({reference:'saved-reference',purpose:'listing',plan:null})});
 s.run('currentUser={id:"test",email:"test@example.invalid"}');
 s.client.functions={invoke:async()=>({data:{verified:false,message:'Pending'},error:null})};
 await s.run('retryPendingPayment()');assert.ok(s.storage.has('nf_pending_payment_test'));
 assert.match(s.element('toast').textContent,/saved-reference/);
});

test('signed-in favorites are stored remotely and failed deletes retain the saved item',async()=> {
 const s=setup(); let saved;
 s.client.from=table=>({upsert:async(row,options)=>{saved={table,row,options};return {error:null};},delete(){return this;},eq(){return this;},then(resolve){return Promise.resolve({error:{message:'offline'}}).then(resolve);}});
 s.run('currentUser={id:"alice"}'); await s.run('toggleFavorite("p1")');
 assert.equal(saved.table,'saved_properties');assert.equal(saved.row.user_id,'alice');assert.equal(saved.row.property_id,'p1');assert.equal(saved.options.ignoreDuplicates,true);
 assert.equal(s.run('favorites[0]'),'p1');await s.run('toggleFavorite("p1")');assert.equal(s.run('favorites[0]'),'p1');assert.match(s.element('toast').textContent,/Could not update/);
});
test('remote favorites replace the cache and query only the signed-in account',async()=> {
 const s=setup();let filter;
 s.client.from=table=>({select(){assert.equal(table,'saved_properties');return this;},eq(key,value){filter=[key,value];return Promise.resolve({data:[{property_id:'cloud'}],error:null});}});
 s.run('currentUser={id:"alice"};favorites=["old"]');await s.run('loadSavedProperties()');assert.deepEqual(filter,['user_id','alice']);assert.equal(s.run('JSON.stringify(favorites)'),'["cloud"]');
});
test('late favorite save cannot modify another account',async()=> {
 const s=setup();let finish;
 s.client.from=()=>({upsert:()=>new Promise(resolve=>{finish=resolve;})});
 s.run('currentUser={id:"alice"}');const pending=s.run('toggleFavorite("private")');s.run('currentUser={id:"bob"};loadAccountState()');finish({error:null});await pending;assert.equal(s.run('favorites.length'),0);
});
test('duplicate favorite clicks issue one request',async()=> {
 const s=setup();let finish,count=0;
 s.client.from=()=>({upsert:()=>{count++;return new Promise(resolve=>{finish=resolve;});}});
 s.run('currentUser={id:"alice"}');const pending=s.run('toggleFavorite("p1")');await s.run('toggleFavorite("p1")');assert.equal(count,1);finish({error:null});await pending;assert.equal(s.run('favorites.length'),1);
});

function chain(result, calls=[]) {
 const q={};
 for(const name of ['select','eq','in','is','order','or','update','insert','delete','limit','gt']) q[name]=(...args)=>{calls.push([name,...args]);return q;};
 q.then=(yes,no)=>Promise.resolve(typeof result==='function'?result():result).then(yes,no);
 q.single=q.maybeSingle=()=>Promise.resolve(typeof result==='function'?result():result);
 return q;
}
function visibleChat(s) {
 s.element('screen-chat').classList.contains=name=>name==='active';
 s.run('currentUser={id:"receiver"};currentChatId="c";conversations=[{id:"c",propertyId:"p",otherUserId:"sender",unread:true}];chatMessages.c=[{id:"m",sender:"received",readAt:null}]');
}
test('read receipts update only received visible message IDs and wait for confirmation',async()=>{
 const s=setup(),calls=[];visibleChat(s);let done;
 s.client.from=()=>chain(()=>new Promise(resolve=>{done=resolve;}),calls);
 const pending=s.run('markConversationRead(conversations[0])');
 assert.equal(s.run('conversations[0].unread'),true);
 assert.deepEqual(calls.find(x=>x[0]==='eq'),['eq','receiver_id','receiver']);
 assert.equal(JSON.stringify(calls.find(x=>x[0]==='in')),JSON.stringify(['in','id',['m']]));
 await Promise.resolve();done({data:[{id:'m',read_at:'2026-10-04T00:00:00Z'}],error:null});await pending;
 assert.equal(s.run('conversations[0].unread'),false);
 assert.deepEqual(Object.keys(calls.find(x=>x[0]==='update')[1]),['read_at']);
});
test('hidden or closed chats do not mark messages read; failed updates keep unread',async()=>{
 const s=setup();visibleChat(s);let calls=0;s.client.from=()=>{calls++;return chain({error:{message:'offline'}});};
 s.context.document.visibilityState='hidden';await s.run('markConversationRead(conversations[0])');assert.equal(calls,0);
 s.context.document.visibilityState='visible';await s.run('markConversationRead(conversations[0])');assert.equal(s.run('conversations[0].unread'),true);
});
test('a late read receipt cannot clear a newly arrived unread message',async()=>{
 const s=setup();visibleChat(s);let done;s.client.from=()=>chain(()=>new Promise(r=>done=r));
 const pending=s.run('markConversationRead(conversations[0])');await Promise.resolve();
 s.run('chatMessages.c.push({id:"new",sender:"received",readAt:null})');done({data:[{id:'m',read_at:'now'}]});await pending;assert.equal(s.run('conversations[0].unread'),true);
});
test('opening another account during read confirmation leaves its state untouched',async()=>{
 const s=setup();visibleChat(s);let done;s.client.from=()=>chain(()=>new Promise(r=>done=r));
 const pending=s.run('markConversationRead(conversations[0])');await Promise.resolve();s.run('currentUser={id:"bob"};conversations=[{id:"c",unread:true}];chatMessages.c=[]');done({data:[{id:'m',read_at:'now'}]});await pending;assert.equal(s.run('conversations[0].unread'),true);
});
test('saved list distinguishes loading and errors from a genuinely empty list',()=>{
 const s=setup();s.run('catalogState="loading";renderSavedProperties()');assert.match(s.element('list-content').innerHTML,/Loading saved/);
 s.run('catalogState="error";renderSavedProperties()');assert.match(s.element('list-content').innerHTML,/Try again/);
 s.run('catalogState="ready";renderSavedProperties()');assert.match(s.element('list-content').innerHTML,/No saved properties yet/);
});
test('catalogue completion refreshes an already-open saved list',async()=>{
 const s=setup();s.element('screen-list').classList.contains=()=>true;s.element('list-title').textContent='Saved Properties';
 s.run('favorites=["p"];loadPublicOwnerProfiles=async()=>{}');s.client.from=()=>chain({data:[{id:'p',title:'Saved home',photos:[]}],error:null});
 await s.run('loadSupabaseProperties()');assert.match(s.element('list-content').innerHTML,/Saved home/);
});
test('sync skips deleted legacy favorites and still loads the remote list',async()=>{
 const s=setup();const id='ffffffff-0000-4000-8000-000000000001';s.run(`currentUser={id:'alice'};favorites=['${id}']`);
 s.client.from=table=>chain({data:table==='properties'?[]:[{property_id:'remote'}],error:null});
 await s.run('loadSavedProperties()');assert.equal(s.run('favorites[0]'),'remote');assert.equal(s.run('savedPropertiesState'),'ready');
});
test('notification acknowledgement does not mark a new arrival read',async()=>{
 const s=setup();let done;s.run('currentUser={id:"alice"};notifications=[{id:"old",read:false}]');s.client.from=()=>chain(()=>new Promise(r=>done=r));
 const pending=s.run('markAllNotificationsRead()');await Promise.resolve();s.run('notifications.push({id:"new",read:false})');done({data:[{id:'old'}]});await pending;
 assert.equal(s.run('notifications[0].read'),true);assert.equal(s.run('notifications[1].read'),false);
});
test('support live echo and insert reply produce only one message',async()=>{
 const user={id:'alice'},s=setup({},user);let done;s.run('currentUser={id:"alice"};syncAuthenticatedUser=async()=>currentUser;startRealtimeSupport()');s.element('support-chat-input').value='Help';
 s.client.from=()=>chain(()=>new Promise(r=>done=r));const pending=s.run('sendSupportMessage()');await Promise.resolve();await Promise.resolve();await Promise.resolve();
 const row={id:'s1',user_id:'alice',sender_type:'user',content:'Help',created_at:new Date().toISOString()};
 await s.realtimeHandlers[0]({new:row});done({data:row,error:null});await pending;assert.equal(s.run('supportMessages.filter(m=>m.id==="s1").length'),1);
});
test('completed photos are reused when another upload fails and is retried',async()=>{
 const s=setup();let attempts={};s.run('currentUser={id:"alice"};photoFiles=[{name:"good.jpg",type:"image/jpeg",size:2},{name:"retry.jpg",type:"image/jpeg",size:2}]');
 s.client.storage={from:()=>({upload:async(path,file)=>{attempts[file.name]=(attempts[file.name]||0)+1;return {error:file.name==='retry.jpg'&&attempts[file.name]===1?{message:'offline'}:null};},list:async()=>({data:[],error:null}),getPublicUrl:path=>({data:{publicUrl:'https://example.test/'+path}})})};
 await assert.rejects(s.run('uploadSelectedMedia()'));const result=await s.run('uploadSelectedMedia()');assert.equal(result.uploadedPhotos.length,2);assert.equal(attempts['good.jpg'],1);assert.equal(attempts['retry.jpg'],2);
});
test('upload snapshot cannot absorb later draft changes or another account',async()=>{
 const s=setup();let done;s.run('currentUser={id:"alice"};photoFiles=[{name:"one.jpg",type:"image/jpeg"}]');
 s.client.storage={from:()=>({upload:()=>new Promise(r=>done=r),getPublicUrl:path=>({data:{publicUrl:'https://example.test/'+path}})})};
 const pending=s.run('uploadSelectedMedia()');s.run('currentUser={id:"bob"};photoFiles=[]');done({error:null});await assert.rejects(pending,/session changed/);
});
test('profile errors stop publication before media is uploaded',async()=>{
 const s=setup();s.run('currentUser={id:"alice"};pendingListingPayload={title:"Home"};uploadSelectedMedia=async()=>{throw new Error("Unexpected upload")};');
 s.client.from=()=>({upsert:async()=>({error:{message:'Profile rejected'}})});
 assert.equal(await s.run('publishListingAfterPayment("ref")'),false);assert.match(s.element('toast').textContent,/Profile rejected/);
});
test('interrupted video resumes with the same upload instance and object path',async()=>{
 const s=setup();let uploads=0,starts=0,paths=[];
 s.run('currentUser={id:"alice"};videoFile={name:"tour.mp4",type:"video/mp4",size:7000000}');
 s.client.auth.getSession=async()=>({data:{session:{user:{id:'alice'},access_token:'test-only'}}});
 s.client.storage={from:()=>({getPublicUrl:path=>({data:{publicUrl:'https://example.test/'+path}})})};
 s.context.window.tus={Upload:class {constructor(file,options){uploads++;this.options=options;}start(){starts++;paths.push(this.options.metadata.objectName);if(starts===1)this.options.onError(new Error('offline'));else this.options.onSuccess();}abort(){return Promise.resolve();}}};
 await assert.rejects(s.run('uploadSelectedMedia()'),/offline/);const result=await s.run('uploadSelectedMedia()');assert.equal(uploads,1);assert.equal(starts,2);assert.equal(paths[0],paths[1]);assert.ok(result.uploadedVideo);
});
test('resetting a draft aborts resumable media and releases its pending operation',async()=>{
 const s=setup();let aborted=false;s.run('currentUser={id:"alice"};videoFile={name:"tour.mp4",type:"video/mp4",size:7000000}');
 s.client.auth.getSession=async()=>({data:{session:{user:{id:'alice'},access_token:'test-only'}}});
 s.context.window.tus={Upload:class {constructor(file,options){this.options=options;}start(){}abort(){aborted=true;return Promise.resolve();}}};
 const pending=s.run('uploadSelectedMedia()');for(let i=0;i<8;i++)await Promise.resolve();s.run('resetListingForm()');await assert.rejects(pending,/cancelled/);assert.equal(aborted,true);assert.equal(s.run('activeMediaUploads.size'),0);
});
test('failed OTP keeps verification form and successful OTP clears signup state',async()=>{
 const s=setup();const boxes=Array.from({length:6},(_,i)=>({value:String(i+1)}));s.context.document.querySelectorAll=selector=>selector==='.otp-box'?boxes:[];
 s.run('pendingSignup={email:"test@example.test",name:"Tester"};authMode="verify-otp"');s.client.auth.verifyOtp=async()=>({error:{message:'Code expired'}});
 await s.run('handleAuth({preventDefault(){}})');assert.equal(s.run('currentUser'),null);assert.match(s.element('auth-error').textContent,/Code expired/);assert.ok(s.run('pendingSignup'));
 s.client.auth.verifyOtp=async()=>({data:{user:{id:'verified',email:'test@example.test'}}});await s.run('handleAuth({preventDefault(){}})');assert.equal(s.run('currentUser.id'),'verified');assert.equal(s.run('pendingSignup'),null);
});
test('requester cancellation is visible only on active own viewing requests',()=>{
 const s=setup();s.run('currentUser={id:"seeker"};viewings=[{id:"v",requesterId:"seeker",ownerId:"owner",status:"Accepted"}];renderViewingSchedule()');assert.match(s.element('list-content').innerHTML,/Cancel viewing/);
 s.run('viewings[0].status="Cancelled";renderViewingSchedule()');assert.doesNotMatch(s.element('list-content').innerHTML,/Cancel viewing/);
});
