import { createScene } from '../../src/render';
import { getCampaign, getMission } from '../../src/content';
import { createSim } from '../../src/sim';
import { recordSortie } from './pilot';
import { renderTrailerAudio } from './audio';
import type { ExtendedSimState } from '../../src/sim/types';

// This page is a development entrypoint, not imported by the shipping game.
if (!import.meta.env.DEV) throw new Error('Trailer capture is development-only');
const width = innerWidth, height = innerHeight, portrait = height > width;
const view = createScene(document.querySelector<HTMLElement>('#scene')!, {externalClock: true, pixelRatio: 1});
const output = document.createElement('canvas');
output.width = width; output.height = height;
const ctx = output.getContext('2d')!;
const face = new FontFace('Trailer', `url(${import.meta.env.BASE_URL}fonts/Rajdhani-SemiBold.ttf)`);
await face.load(); document.fonts.add(face);
function sortie(id: 'sg_fictional_2026_10' | 'jp_ketapang_2026_09', missionId: string) {
  const c = getCampaign(id)!, m = getMission(id,missionId)!;
  // Construct actual scenery/colliders before piloting the simulation.
  view.update(createSim(c,m), c,m);
  return recordSortie(id,missionId);
}
const sg = sortie('sg_fictional_2026_10','SG-01');
const jp = sortie('jp_ketapang_2026_09','JP-02');
type Recording = typeof sg;
const find = (r:Recording,p:(s:ExtendedSimState)=>boolean) => {
  const i = r.frames.findIndex(p); if(i<0) throw new Error(`Missing shot event in ${r.mission.id}`); return i;
};
const sgDrop = find(sg,s=>s.dumping);
const jpDrop = find(jp,s=>s.dumping);
const sgFill = find(sg,s=>s.waterLitres>10);
const sgFull = find(sg,s=>s.waterLitres>=4900);
const depart = find(sg,s=>s.phase==='depart');
const lastAboveDeck = (r:Recording) => r.frames.length - 1 - [...r.frames].reverse().findIndex(s=>s.position.y>3);
const shots = [
  {id:'reveal', seconds:5, r:sg, source:0, camera:'ship'},
  {id:'departure',seconds:4,r:sg,source:depart+60,camera:'side'},
  {id:'transit',seconds:3,r:sg,source:Math.max(depart,sgFill-420),camera:'wide'},
  {id:'pickup',seconds:4,r:sg,source:sgFill-45,camera:'bucket'},
  {id:'loaded',seconds:4,r:sg,source:sgFull,camera:'side'},
  {id:'approach',seconds:4,r:sg,source:sgDrop-120,camera:'fire'},
  {id:'release',seconds:5,r:sg,source:sgDrop,camera:'drop'},
  {id:'japan-work',seconds:4,r:jp,source:jpDrop,camera:'drop'},
  {id:'japan-recovery',seconds:4,r:jp,source:lastAboveDeck(jp)-60,camera:'ship'},
  {id:'singapore-recovery',seconds:5,r:sg,source:lastAboveDeck(sg)-60,camera:'ship'},
  {id:'close',seconds:3,r:sg,source:sg.frames.length-90,camera:'ship'},
].map((s,i,a)=>({...s,source:Math.max(0,s.source),start:a.slice(0,i).reduce((n,s)=>n+s.seconds*30,0)}));
function stateFor(shot:typeof shots[number],offset:number){return shot.r.frames[Math.min(shot.r.frames.length-1,Math.max(0,shot.source+offset))];}
function pose(shot:typeof shots[number],s:ExtendedSimState,progress:number){
 const p=s.position, b=s.bucket;
 let target={x:p.x,y:p.y+(s.bucketAttached?-10:0),z:p.z};
 let distance=portrait?86:66, elevation=22, angle=.8+progress*.16;
 if(shot.camera==='ship') { distance=portrait?135:150; elevation=portrait?48:45; angle=1.02+progress*.18; target={x:p.x,y:p.y-1,z:p.z-10}; }
 if(shot.camera==='wide') {distance=portrait?115:110;elevation=35;angle=1.4+progress*.10;}
 if(shot.camera==='bucket') {target={x:b.x,y:b.y+9,z:b.z};distance=portrait?77:68;elevation=14;angle=.92+progress*.15;}
 if(shot.camera==='fire'||shot.camera==='drop') {target={x:p.x,y:p.y-20,z:p.z};distance=portrait?103:82;elevation=32;angle=1.1+progress*.12;}
 return {position:{x:target.x+Math.cos(angle)*distance,y:target.y+elevation,z:target.z+Math.sin(angle)*distance},target,fov:portrait?49:45};
}
// Keep reflection throttling tied to output time, independent of capture speed.
let captureClock = 0;
Object.defineProperty(performance, 'now', { configurable: true, value: () => captureClock });
const advanceFrame = (camera:ReturnType<typeof pose>) => { captureClock += 1000 / 30; view.renderFrame(1/30,camera); };
let previousShot=-1;
let dissolveFrames:HTMLCanvasElement[]=[];
function drawTitles(index:number){
 const t=index/30, unit=width/1920, margin=portrait?84:112;
 const fade=(start:number,end:number)=>Math.min(1,Math.max(0,(t-start)/.65),Math.max(0,(end-t)/.65));
 let alpha=0, kicker='', lines:string[]=[], sub='';
 if(t<5){alpha=fade(.2,4.8);kicker='ACTUAL GAMEPLAY';lines=portrait?['OPS CRIMSON','EAGLE']:['OPS CRIMSON EAGLE'];sub='AERIAL FIREFIGHTING';}
 else if(t<10){alpha=fade(5.3,9.5);kicker='01 / SERUYAN';lines=['RSAF DEPLOYMENT'];sub='Fictional scenario';}
 else if(t>=29&&t<33){alpha=fade(29.2,32.9);kicker='02 / KETAPANG';lines=['JSDF DEPLOYMENT'];sub='Based on a real deployment';}
 else if(t>=42){alpha=fade(42,45.3);kicker='OPS CRIMSON EAGLE';lines=portrait?['TWO CAMPAIGNS.','TWELVE MISSIONS.']:['TWO CAMPAIGNS. TWELVE MISSIONS.'];sub='Take flight. Protect what matters.';}
 if(alpha<=0)return;
 ctx.save();ctx.globalAlpha=alpha;
 const y=portrait?height*.78:height*.76;
 const gradient=ctx.createLinearGradient(0,y-100,0,height);
 gradient.addColorStop(0,'rgba(3,12,15,0)');gradient.addColorStop(1,'rgba(3,12,15,.76)');
 ctx.fillStyle=gradient;ctx.fillRect(0,y-100,width,height-y+100);
 ctx.shadowColor='rgba(0,0,0,.65)';ctx.shadowBlur=12;
 const big=portrait?76:80*unit, small=portrait?30:30*unit;
 ctx.textAlign='left';ctx.fillStyle='#d9e3d1';ctx.font=`600 ${small}px Trailer`;
 ctx.fillText(kicker,margin,y-big-18);
 ctx.fillStyle='#f8f5e9';ctx.font=`600 ${big}px Trailer`;
 lines.forEach((line,i)=>ctx.fillText(line,margin,y+big*i,width-margin*2));
 ctx.font=`600 ${small+4}px Trailer`;ctx.fillStyle='#e2e9e1';
 ctx.fillText(sub,margin,y+big*(lines.length-1)+56,width-margin*2);
 ctx.restore();
}
function frame(index:number, jpeg=true){
 const si=shots.findIndex(s=>index>=s.start&&index<s.start+s.seconds*30);
 if(si<0)throw new Error('Frame outside edit');
 const shot=shots[si], local=index-shot.start;
 if(si!==previousShot){
  dissolveFrames=[];
  if((si===7||si===9)&&previousShot===si-1){
   const outgoing=shots[si-1];
   for(let k=0;k<8;k++){
    const state=stateFor(outgoing,outgoing.seconds*30+k);
    view.update(state,outgoing.r.campaign,outgoing.r.mission);
    advanceFrame(pose(outgoing,state,1+k/(outgoing.seconds*30)));
    const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
    canvas.getContext('2d')!.drawImage(view.canvas,0,0,width,height);dissolveFrames.push(canvas);
   }
  }
  for(let pre=-Math.min(60,shot.source);pre<0;pre++){
   const s=stateFor(shot,pre);view.update(s,shot.r.campaign,shot.r.mission);
   advanceFrame(pose(shot,s,0));
  }
  previousShot=si;
 }
 const s=stateFor(shot,local);
 view.update(s,shot.r.campaign,shot.r.mission);
 advanceFrame(pose(shot,s,local/(shot.seconds*30)));
 ctx.drawImage(view.canvas,0,0,width,height);
 if(local<dissolveFrames.length){ctx.globalAlpha=1-(local+1)/8;ctx.drawImage(dissolveFrames[local],0,0);ctx.globalAlpha=1;}
 drawTitles(index);
 // Fade only the opening and ending; the action montage uses restrained hard cuts.
 const visibility=Math.min(1,index/15,(1350-index)/18);
 if(visibility<1){ctx.fillStyle=`rgba(3,10,13,${1-visibility})`;ctx.fillRect(0,0,width,height);}
 return jpeg?output.toDataURL('image/jpeg',.94).split(',')[1]:output.toDataURL('image/png').split(',')[1];
}
const samples=shots.flatMap(shot=>Array.from({length:shot.seconds*30},(_,i)=>({time:(shot.start+i)/30,state:stateFor(shot,i),campaign:shot.r.campaign,mission:shot.r.mission})));
const metadata={width,height,fps:30,duration:45,sorties:[sg,jp].map(r=>({mission:r.mission.id,duration:r.result.timeSec,outcome:r.result.outcome,fuel:r.result.fuelKg})),shots:shots.map(s=>({id:s.id,start:s.start/30,duration:s.seconds,mission:s.r.mission.id,sourceTime:s.source/30,camera:s.camera}))};
async function audio(){
 const blob=await renderTrailerAudio(samples,45);
 return await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=reject;reader.onload=()=>resolve((reader.result as string).split(',')[1]);reader.readAsDataURL(blob);});
}
Object.assign(window,{trailer:{frame,audio,metadata}});
console.log('TRAILER_READY',JSON.stringify(metadata));
