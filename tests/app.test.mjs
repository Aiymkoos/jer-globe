// DOM-level integration, not a substitute for a camera/WebGL browser session.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {GlobeHands, assignHands, T} from '../js/hands.js';
import {classifyHand, POSE, POSE_NAMES} from '../js/gestures.js';
import {Quiz} from '../js/quiz.js';
import {OneEuro} from '../js/filters.js';
import {HintPolicy,readSpeed,panGain,SPEEDS,globeError} from '../js/interaction.js';
async function setup(fail=false){
 const dom=new JSDOM(readFileSync(new URL('../index.html',import.meta.url),'utf8'),{url:'https://example.test/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 const timers=new Map();let timerId=0;
 w.setTimeout=(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;};w.clearTimeout=id=>timers.delete(id);w.setInterval=()=>0;w.requestAnimationFrame=()=>0;
 w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({},{get:(o,k)=>o[k]??(()=>{}),set:(o,k,v)=>(o[k]=v,true)});
 w.fetch=async()=>({ok:false});w.console.error=()=>{};
 const countries={features:[{id:1,properties:{name:'Казахстан',capital:'Астана',pop:19e6,lx:69,ly:49}},{id:2,properties:{name:'Узбекистан',capital:'Ташкент',pop:35e6,lx:64,ly:41}}]};
 const map={on(){},getSource:()=>({setData(){}}),getZoom:()=>2,getMaxZoom:()=>17,panBy(){},jumpTo(){},flyTo(){}};
 const MODES=['satellite','drained','flood','iceage','night','live','quiz'].map(id=>({id,name:id,desc:'Режим '+id}));
 w.deps={GlobeHands,assignHands,T,classifyHand,POSE,POSE_NAMES,Quiz,OneEuro,HintPolicy,readSpeed,panGain,SPEEDS,globeError,MODES,LEVEL_RANGE:[-130,100],applyMode(){},setLevel(){},countryAt:()=>null,onGlobe:()=>true,setFlag(){},preload:async()=>({}),fetchQuakes:async()=>({features:[]}),fetchIss:async()=>({lng:0,lat:0,alt:400,speed:28000}),countryAtLngLat:()=>null,timeAgo:()=>'',createGlobe:async()=>{if(fail)throw new Error('WebGL2 is required');return{map,countries};}};
 const source=readFileSync(new URL('../js/main.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'');
 w.eval('const {'+Object.keys(w.deps).join(',')+'}=window.deps;\n'+source+'\nwindow.hooks={state,engine,setMode,startQuiz,answerQuiz,showCard,point,frame};');
 await new Promise(setImmediate);
 return{dom,w,d:w.document,h:w.hooks,timers,countries};
}
test('GPU failure keeps start open and disables both launch paths',async()=>{const{dom,d}=await setup(true);assert.equal(d.getElementById('camStart').disabled,true);assert.equal(d.getElementById('mouseStart').disabled,true);assert.equal(d.getElementById('retryMap').hidden,false);assert.match(d.getElementById('mapStatus').textContent,/WebGL2/);d.getElementById('mouseStart').click();assert.equal(d.getElementById('start').hidden,false);dom.window.close();});
test('mouse launch, persistent help, sensitivity and close/reopen card',async()=>{const{dom,d,h,countries}=await setup();assert.equal(h.engine.style,'drag');assert.equal(d.getElementById('mouseStart').disabled,false);d.getElementById('mouseStart').click();assert.equal(d.getElementById('start').hidden,true);d.getElementById('helpToggle').click();assert.equal(d.getElementById('helpPanel').hidden,false);assert.equal(d.getElementById('helpToggle').getAttribute('aria-expanded'),'true');d.getElementById('sensitivity').click();assert.match(d.getElementById('sensitivity').textContent,/Быстро/);const c={id:1,...countries.features[0].properties};await h.showCard(c);d.getElementById('closeCard').click();assert.equal(h.state.cardId,null);await h.showCard(c);assert.equal(d.getElementById('card').hidden,false);dom.window.close();});
test('leaving quiz cancels delayed next question; restarting clears lock',async()=>{const{dom,h,timers}=await setup();h.setMode('quiz');h.answerQuiz(h.state.quiz.target);assert.equal(timers.size,1);assert.ok(h.state.quizLock>0);h.setMode('satellite');assert.equal(timers.size,0);h.setMode('quiz');assert.equal(h.state.quiz.index,0);assert.equal(h.state.quizLock,0);dom.window.close();});
test('help overlay cannot accidentally submit ocean as quiz answer',async()=>{const{dom,d,h}=await setup();h.setMode('quiz');d.elementFromPoint=()=>d.getElementById('helpPanel');h.point({x:.5,y:.5},'Right',0);h.point({x:.5,y:.5},'Right',2000);assert.equal(h.state.dwell.Right.target,null);assert.equal(h.state.quiz.tries,0);dom.window.close();});
