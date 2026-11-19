const $=id=>document.getElementById(id),show=(id,on=true)=>$(id).classList.toggle('hidden',!on);
let session=null,state=null,events=null,connected=false,offset=0,layout='',docks=new Map(),nodes=new Map(),pos={x:500,y:130},flight=null,lastSeq=-1,lastPop='',busy=false,lastLast='';
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const sv=(tag,attrs={},text)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(text!==undefined)e.textContent=text;return e};
const storage={get(){try{return JSON.parse(sessionStorage.getItem('pufferSession'))}catch{return null}},set(v){try{sessionStorage.setItem('pufferSession',JSON.stringify(v))}catch{}}};
async function api(path,data){const start=Date.now();const r=await fetch('/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(12000)});const b=await r.json();if(!r.ok)throw Error(b.error||'Request failed.');if(b.serverNow)offset=b.serverNow-(start+Date.now())/2;return b}
function joinLink(){return location.origin+'/?room='+session.code}
function connect(s){
 session=s;storage.set(s);events?.close();show('entry',false);show('game');$('entryError').textContent='';$('roomCode').textContent=s.code;$('role').textContent=s.id==='host'?'Teacher host':'Team player';
 $('linkText').textContent='Student join link: '+joinLink();
 events=new EventSource('/api/events?'+new URLSearchParams({code:s.code,token:s.token}));
 events.onopen=()=>{connected=true;$('connection').textContent='● Connected';render()};
 events.onmessage=e=>{const incoming=JSON.parse(e.data);offset=incoming.serverNow-Date.now();state=incoming;render()};
 events.onerror=()=>{connected=false;$('connection').textContent='Reconnecting… answers disabled';render()};
}
function drawCircle(){
 const signature=state.players.map(p=>p.id).join(',');if(signature===layout)return;layout=signature;docks.clear();nodes.clear();$('stations').replaceChildren();
 state.players.forEach((p,i)=>{const a=-Math.PI/2+i*Math.PI*2/state.players.length,x=500+365*Math.cos(a),y=350+200*Math.sin(a),g=sv('g',{class:'station',transform:`translate(${x} ${y})`});
 docks.set(p.id,{x,y:y-70});g.append(sv('title',{},p.name));g.append(sv('rect',{x:-70,y:-13,width:140,height:49,rx:12}));g.append(sv('text',{x:0,y:6,'text-anchor':'middle','font-size':state.players.length>10?11:14,'font-weight':750},p.name.length>17?p.name.slice(0,16)+'…':p.name));const t=sv('text',{x:0,y:25,'text-anchor':'middle','font-size':10});g.append(t);nodes.set(p.id,{g,t});$('stations').append(g);
 });
}
function place(p,angle=0){pos={...p};$('puffer').setAttribute('transform',`translate(${p.x} ${p.y}) rotate(${angle})`)}
function burst(p){
 $('effects').replaceChildren();if(!p)return;
 if(!reduced())for(let i=0;i<24;i++){const a=i*Math.PI*2/24,d=55+i%5*17,e=sv('circle',{cx:p.x,cy:p.y,r:5+i%5,fill:i%3?'#b1f9f0':'#ffe09a',class:'particle'});e.style.setProperty('--x',Math.cos(a)*d+'px');e.style.setProperty('--y',Math.sin(a)*d+'px');$('effects').append(e)}
 $('effects').append(sv('text',{x:p.x,y:p.y+10,'text-anchor':'middle',class:'poptext'},'POP!'));
}
function chips(id,arr){$(id).replaceChildren();arr.forEach(t=>{const e=document.createElement('span');e.className='chip';e.textContent=t;$(id).append(e)})}
function render(){
 if(!state||!session)return;const host=session.id==='host',p=state.players.find(p=>p.id===state.turn),me=state.players.find(p=>p.id===session.id);
 drawCircle();$('round').textContent=state.phase==='lobby'?'Lobby':`Round ${state.round} · Unit ${state.questionUnit}`;
 $('prompt').textContent=state.prompt;$('notice').textContent=state.notice;$('holder').textContent=p?p.name+' holds the puffer':'Waiting for teams';
 $('roster').replaceChildren();state.players.forEach(p=>{
 const n=nodes.get(p.id);n.g.setAttribute('class','station'+(p.id===state.turn?' active':'')+(p.lives===0?' out':''));n.t.textContent=(p.lives?'♥ '.repeat(p.lives):'OUT')+(p.online?' · online':' · offline');
 const d=document.createElement('div');d.className='team'+(p.id===state.turn?' active':'')+(p.lives===0?' out':'');
 const a=document.createElement('div'),name=document.createElement('strong');name.className='teamname';name.textContent=p.name;const s=document.createElement('div');const small=document.createElement('small');small.textContent=`${p.passes} passes · ${p.online?'online':'offline'}`;s.append(small);a.append(name,s);
 const l=document.createElement('span');l.textContent=p.lives?'♥ '.repeat(p.lives):'Out';d.append(a,l);
 if(host&&['lobby','paused','ready','popped','cleared'].includes(state.phase)){const b=document.createElement('button');b.className='secondary';b.textContent='Remove';b.onclick=()=>{if(confirm('Remove '+p.name+' from this match?'))action('remove',{id:p.id})};d.append(b)}$('roster').append(d);
 });
 chips('used',state.history.map(h=>h.name+': '+h.answer+(h.teacher?' · teacher accepted':'')));
 show('controls',host);for(const [id,phase]of Object.entries({start:'lobby',begin:'ready',pause:'running',resume:'paused'})){show(id,state.phase===phase);$(id).disabled=!connected||busy}
 show('next',['popped','cleared'].includes(state.phase));show('review',host&&state.phase==='paused');
 show('learning',Boolean(state.note));$('note').textContent=state.note||'';chips('examples',state.examples||[]);
 const reviewKey=JSON.stringify(state.last);if(reviewKey!==lastLast){lastLast=reviewKey;if(state.last)$('ruling').value=state.last.text}
 const yourTurn=state.phase==='running'&&me?.id===state.turn&&me.lives>0;show('answerForm',!host);const can=yourTurn&&connected&&!busy;
 const was=$('answer').disabled;$('answer').disabled=!can;$('pass').disabled=!can;
 if(can&&was)$('answer').focus();
 if(!host&&!yourTurn)$('answer').placeholder=state.phase==='lobby'?'Waiting for the host…':me?.lives===0?'Your team is out — watch the reef!':'Watch the puffer — wait for your turn';else $('answer').placeholder='Type an answer…';
 const labels={lobby:'Waiting for teams',ready:'Get ready',running:'The fuse is live',paused:'Paused',popped:'Puffer popped!',cleared:'Category cleared!',ended:'Match complete'};
 $('center').textContent=labels[state.phase];$('sub').textContent=state.phase==='ended'?(state.winner?state.winner+' wins!':'Match ended'):state.phase==='paused'?'Teacher controls the remaining time':state.phase==='running'?'Answer fast. Pass the puffer!':'The host controls the next step';
 const target=docks.get(state.turn);if(target&&state.seq!==lastSeq){
   const oldSeq=lastSeq;lastSeq=state.seq;$('answer').value='';$('answerError').textContent='';
   if(oldSeq>=0&&state.phase==='running'&&!reduced()){flight={from:{...pos},to:target,start:performance.now()};$('trail').setAttribute('d',`M${pos.x} ${pos.y} Q${(pos.x+target.x)/2} ${(pos.y+target.y)/2-65} ${target.x} ${target.y}`)}else{flight=null;place(target);$('trail').setAttribute('d','')}
 }
 const popped=state.popped?state.code+':'+state.popped.round:'';if(popped&&popped!==lastPop){lastPop=popped;flight=null;burst(docks.get(state.popped.id))}if(!popped)$('effects').replaceChildren();
 $('puffer').setAttribute('visibility',target&&!['lobby','popped','ended'].includes(state.phase)?'visible':'hidden');
}
function animate(now){
 if(state){
   if(flight){const t=Math.min(1,(now-flight.start)/420),u=1-t,c={x:(flight.from.x+flight.to.x)/2,y:(flight.from.y+flight.to.y)/2-65};place({x:u*u*flight.from.x+2*u*t*c.x+t*t*flight.to.x,y:u*u*flight.from.y+2*u*t*c.y+t*t*flight.to.y},Math.sin(t*Math.PI)*12);if(t===1){flight=null;$('trail').setAttribute('d','')}}
   const left=state.phase==='running'?Math.max(0,state.deadline-Date.now()-offset):state.remaining;
   $('inflate').setAttribute('transform',`scale(${1+Math.max(0,Math.min(1,1-left/10000))*.5})`);$('puffer').classList.toggle('shaking',state.phase==='running'&&left<2200);
 }requestAnimationFrame(animate);
}
async function action(actionName,extra={}){
 if(!connected||busy||!state)return;busy=true;render();try{await api('action',{...session,action:actionName,seq:state.seq,...extra});$('answerError').textContent=''}catch(e){$('answerError').textContent=e.message}finally{busy=false;render()}
}
$('hostForm').onsubmit=async e=>{e.preventDefault();try{connect(await api('create',{unit:$('unit').value,lives:+$('lives').value,hostKey:$('hostKey').value}));$('hostKey').value=''}catch(e){$('entryError').textContent=e.message}};
$('joinForm').onsubmit=async e=>{e.preventDefault();try{connect(await api('join',{code:$('code').value.trim(),name:$('name').value.trim()}))}catch(e){$('entryError').textContent=e.message}};
$('answerForm').onsubmit=e=>{e.preventDefault();action('answer',{text:$('answer').value.trim()})};
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));$('approve').onclick=()=>action('approve',{text:$('ruling').value.trim()});
$('leave').onclick=()=>{if(!confirm('Leave this screen? The teacher can remove your team if needed.'))return;events?.close();storage.set(null);location.href='/'};
$('copyLink').onclick=async()=>{try{await navigator.clipboard.writeText(joinLink());$('copyLink').textContent='Copied!'}catch{$('copyLink').textContent='Copy the join link shown above'}};
const room=new URLSearchParams(location.search).get('room');if(room)$('code').value=room.replace(/\D/g,'').slice(0,6);
const saved=storage.get();if(saved&&(!room||saved.code===room)){api('resume',saved).then(connect).catch(()=>{storage.set(null);$('entryError').textContent='Previous room expired. Create or join a new room.'})}
requestAnimationFrame(animate);
