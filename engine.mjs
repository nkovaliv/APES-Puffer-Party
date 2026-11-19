import {randomBytes,randomInt} from 'node:crypto';
import {bank,norm} from './bank.mjs';
const token=()=>randomBytes(24).toString('hex');
const check=(condition,message)=>{if(!condition)throw Error(message)};
export class Game {
  constructor({unit='all',lives=3,now=()=>Date.now()}={}) {
    check(unit==='all'||Number.isInteger(+unit)&&+unit>=1&&+unit<=9,'Choose a valid unit.');
    check([2,3,5].includes(+lives),'Choose 2, 3, or 5 lives.');
    this.now=now;this.unit=String(unit);this.initialLives=+lives;this.host={id:'host',token:token(),online:false};
    this.players=[];this.phase='lobby';this.round=0;this.seq=0;this.turn=null;this.q=null;this.deadline=0;this.remaining=10000;
    this.used=new Set();this.keys=new Set();this.history=[];this.deck=[];this.last=null;this.notice='Waiting for teams.';this.popped=null;
    this.created=this.now();this.updated=this.created;
  }
  actor(t){return [this.host,...this.players].find(p=>p.token===t)}
  alive(){return this.players.filter(p=>p.lives>0)}
  current(){return this.players.find(p=>p.id===this.turn)}
  next(){const at=this.players.findIndex(p=>p.id===this.turn);for(let i=1;i<=this.players.length;i++){const p=this.players[(at+i)%this.players.length];if(p.lives>0&&p.online)return p.id}return null}
  join(name){
    check(this.phase==='lobby','The match has started. Ask the host to create a new room.');
    check(typeof name==='string'&&name.trim().length>0&&name.trim().length<=30,'Use a team name of 1–30 characters.');
    check(this.players.length<16,'This room already has 16 teams.');
    check(!this.players.some(p=>p.name.toLowerCase()===name.trim().toLowerCase()),'That team name is already taken.');
    const p={id:token().slice(0,12),token:token(),name:name.trim(),lives:this.initialLives,passes:0,online:false};this.players.push(p);return p;
  }
  pause(reason='Teacher paused the fuse.'){
    if(this.phase!=='running')return;this.remaining=Math.max(0,this.deadline-this.now());this.phase='paused';this.notice=reason;
  }
  settle(){
    if(this.phase==='running'&&this.now()>=this.deadline){
      const p=this.current();p.lives--;this.popped={id:p.id,at:this.now(),round:this.round};this.phase='popped';this.remaining=0;this.notice=p.name+' lost a life!';this.seq++;
      if(this.alive().length===1)this.phase='ended';return true;
    }return false;
  }
  connection(actor,on){
    this.settle();actor.online=on;
    if(!on&&this.phase==='running'&&(actor===this.host||actor.id===this.turn))this.pause(actor===this.host?'Host disconnected. Reconnect, then resume.':'The holding team disconnected. Reconnect or remove that team, then resume.');
  }
  newRound(){
    const available=this.alive().filter(p=>p.online);check(available.length>=2,'At least two surviving teams must be connected.');
    if(!this.deck.length){this.deck=bank.filter(q=>this.unit==='all'||q.unit===+this.unit).slice();for(let i=this.deck.length-1;i>0;i--){const j=randomInt(i+1);[this.deck[i],this.deck[j]]=[this.deck[j],this.deck[i]]}if(this.q&&this.deck.length>1&&this.deck.at(-1).id===this.q.id)[this.deck[0],this.deck[this.deck.length-1]]=[this.deck.at(-1),this.deck[0]]}
    const previous=this.turn;this.q=this.deck.pop();this.round++;this.seq++;this.phase='ready';this.remaining=10000;this.deadline=0;this.used.clear();this.keys.clear();this.history=[];this.last=null;this.popped=null;
    this.turn=previous?this.next():available[randomInt(available.length)].id;this.notice='Read the category. The host starts the fuse.';
  }
  pass(text,teacher=false){
    check(typeof text==='string'&&text.length<=100&&norm(text),'Enter an answer of 1–100 characters.');const key=norm(text),idx=this.q.answers.findIndex(a=>a.keys.includes(key));
    check(!this.keys.has(key)&&!(idx>=0&&this.used.has(idx)),'Already used this round. Synonyms count as a repeat.');
    if(idx<0&&!teacher){this.last={id:this.turn,text:text.trim()};throw Error('Not in the answer bank. Try another answer, or ask the teacher to pause and review.');}
    this.keys.add(key);if(idx>=0){this.used.add(idx);this.q.answers[idx].keys.forEach(k=>this.keys.add(k))}
    const p=this.current();p.passes++;const answer=idx>=0?this.q.answers[idx].name:text.trim();
    this.history.push({name:p.name,answer,teacher});this.last=null;this.notice=p.name+': '+answer+' ✓';this.turn=this.next()||p.id;this.seq++;
    if(this.used.size===this.q.answers.length){this.phase='cleared';this.notice='Every bank answer found! Safe round: no life lost.';return}
    if(this.alive().filter(p=>p.online).length<2){this.pause('Waiting for at least two connected teams.');}
  }
  command(actor,action,b={}){
    this.updated=this.now();this.settle();
    if(action==='answer'){
      check(actor!==this.host&&actor.id===this.turn,'Only the holding team can answer.');check(this.phase==='running','The fuse is not running.');
      check(b.seq===this.seq,'The turn changed. Wait for the current turn.');this.pass(b.text);return;
    }
    check(actor===this.host,'Only the host can use teacher controls.');
    if(action==='start'){check(this.phase==='lobby','Match already started.');check(this.players.length>=2&&this.players.every(p=>p.online),'Connect at least two teams; remove any offline teams first.');this.newRound();return}
    if(action==='begin'||action==='resume'){
      check(this.phase===(action==='begin'?'ready':'paused'),'This control is not available now.');
      check(this.host.online&&this.current()?.online&&this.alive().filter(p=>p.online).length>=2,'Connect the host and at least two surviving teams, including the holding team.');
      this.deadline=this.now()+this.remaining;this.phase='running';this.notice='The 10-second fuse is live!';return;
    }
    if(action==='pause'){check(this.phase==='running','The fuse is not running.');this.pause();return}
    if(action==='approve'){check(this.phase==='paused','Pause before reviewing an answer.');check(b.seq===this.seq,'The turn changed. Review the current turn.');check(this.current()?.online,'Reconnect the holding team first.');this.pass(b.text,true);return}
    if(action==='next'){check(['popped','cleared'].includes(this.phase),'Finish the round first.');this.newRound();return}
    if(action==='remove'){
      check(['lobby','paused','ready','popped','cleared'].includes(this.phase),'Pause before removing a team.');const p=this.players.find(p=>p.id===b.id);check(p,'Team not found.');
      if(this.phase==='lobby'){this.players=this.players.filter(t=>t!==p);return}
      p.lives=0;if(this.alive().length<=1){this.phase='ended';this.notice='Match ended by teacher removal.';return}
      if(p.id===this.turn){this.turn=this.next()||this.alive()[0].id;this.seq++}return;
    }
    throw Error('Unknown control.');
  }
  state(){
    return {phase:this.phase,round:this.round,seq:this.seq,unit:this.unit,turn:this.turn,remaining:this.remaining,deadline:this.deadline,serverNow:this.now(),hostOnline:this.host.online,
      players:this.players.map(({token,...p})=>p),prompt:this.q?.prompt||'Join the reef!',questionUnit:this.q?.unit,notice:this.notice,history:this.history,last:this.last,popped:this.popped,
      note:['popped','cleared','ended'].includes(this.phase)?this.q?.note:null,
      examples:['popped','cleared','ended'].includes(this.phase)?this.q?.answers.filter((a,i)=>!this.used.has(i)).slice(0,6).map(a=>a.name):[],
      winner:this.phase==='ended'?this.alive()[0]?.name:null};
  }
}
