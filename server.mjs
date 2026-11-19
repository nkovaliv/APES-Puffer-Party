import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {randomInt} from 'node:crypto';
import {Game} from './engine.mjs';

export function createApp(){
  const rooms=new Map(),limits=new Map();
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
  const broadcast=r=>{const s='data: '+JSON.stringify({...r.game.state(),code:r.code})+'\n\n';for(const res of r.streams.values())res.write(s)};
  const read=async req=>{let data='';for await(const chunk of req){data+=chunk;if(data.length>4096)throw Error('Request too large.')}return JSON.parse(data||'{}')};
  const timer=setInterval(()=>{for(const [code,r] of rooms){if(r.game.settle())broadcast(r);if(Date.now()-r.game.updated>4*60*60*1000){for(const s of r.streams.values())s.end();rooms.delete(code)}}},40);
  const heartbeat=setInterval(()=>{for(const r of rooms.values())for(const res of r.streams.values())res.write(': keepalive\n\n');for(const [k,v]of limits)if(v.until<Date.now())limits.delete(k)},15000);
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
    try{
      const u=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&(u.pathname==='/'||u.pathname==='/client.js')){
        const file=u.pathname==='/'?'public/index.html':'public/client.js';res.setHeader('Content-Type',u.pathname==='/'?'text/html; charset=utf-8':'text/javascript; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(await readFile(new URL(file,import.meta.url)));return;
      }
      if(req.method==='GET'&&u.pathname==='/health'){send(res,200,{ok:true});return}
      if(req.method==='GET'&&u.pathname==='/api/events'){
        const r=rooms.get(u.searchParams.get('code')),a=r?.game.actor(u.searchParams.get('token'));if(!a){send(res,401,{error:'Room expired or session invalid. Return to the start screen.'});return}
        const old=r.streams.get(a.id);r.streams.set(a.id,res);if(old)old.end();
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('retry: 1200\n\n');
        r.game.connection(a,true);r.game.updated=Date.now();broadcast(r);
        res.on('close',()=>{if(r.streams.get(a.id)!==res)return;r.streams.delete(a.id);r.game.connection(a,false);broadcast(r)});return;
      }
      if(req.method!=='POST'||!u.pathname.startsWith('/api/')){send(res,404,{error:'Not found.'});return}
      if(!String(req.headers['content-type']).startsWith('application/json')){send(res,415,{error:'JSON required.'});return}
      const ip=req.socket.remoteAddress,limit=limits.get(ip)||{count:0,until:Date.now()+60000};if(limit.until<Date.now()){limit.count=0;limit.until=Date.now()+60000}limit.count++;limits.set(ip,limit);
      if(limit.count>1200){send(res,429,{error:'Too many requests. Wait a moment.'});return}
      const b=await read(req);
      if(u.pathname==='/api/create'){
        if(process.env.HOST_KEY&&b.hostKey!==process.env.HOST_KEY){send(res,403,{error:'Incorrect teacher hosting password.'});return}
        if(rooms.size>=100){send(res,429,{error:'Server room limit reached.'});return}
        let code;do{code=String(randomInt(100000,1000000))}while(rooms.has(code));
        const game=new Game(b),r={code,game,streams:new Map()};rooms.set(code,r);send(res,200,{code,token:game.host.token,id:'host'});return;
      }
      const r=rooms.get(String(b.code));if(!r){send(res,404,{error:'Room not found. Check the code or ask the host for a new room.'});return}
      if(u.pathname==='/api/join'){const a=r.game.join(b.name);r.game.updated=Date.now();broadcast(r);send(res,200,{code:r.code,token:a.token,id:a.id});return}
      const a=r.game.actor(b.token);if(!a){send(res,403,{error:'Session invalid. Rejoin the room.'});return}
      if(u.pathname==='/api/resume'){send(res,200,{code:r.code,id:a.id,token:a.token});return}
      if(u.pathname==='/api/action'){
        try{r.game.command(a,b.action,b);send(res,200,{ok:true})}catch(e){send(res,400,{error:e.message})}finally{broadcast(r)}return;
      }
      send(res,404,{error:'Not found.'});
    }catch(e){if(!res.headersSent)send(res,400,{error:e instanceof SyntaxError?'Invalid request.':e.message});else res.end()}
  });
  server.on('close',()=>{clearInterval(timer);clearInterval(heartbeat)});
  return {server,rooms,shutdown:()=>{for(const r of rooms.values())for(const s of r.streams.values())s.end();server.close()}};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const {server,shutdown}=createApp();server.listen(process.env.PORT||3000,'0.0.0.0',()=>console.log('APES Puffer Party is running.'));
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
}
