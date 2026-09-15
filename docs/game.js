import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// NEON SWARM: a self-contained arcade loop. World units are intentionally small;
// the camera looks down the Z axis so the formation can dive toward the player.
const canvas = document.querySelector('#gameCanvas');
const stageEl = document.querySelector('#gameStage');
const $ = (selector) => document.querySelector(selector);
const hud = { score: $('#score'), high: $('#highScore'), stage: $('#stage'), lives: $('#lives') };
const screens = { start: $('#startScreen'), pause: $('#pauseScreen'), over: $('#gameOverScreen') };
const COLORS = { cyan: 0x30f3ff, pink: 0xff3dbb, yellow: 0xffe66b, purple: 0x9d58ff, white: 0xffffff };
const storeKey = 'neon-swarm-high-score';
let highScore = Number(localStorage.getItem(storeKey) || 0);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x050713, 34, 100);
const camera = new THREE.PerspectiveCamera(54, 1, .1, 150);
camera.position.set(0, 5, 31); camera.lookAt(0, 0, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x050713, 1);

const game = { state:'start', score:0, stage:1, lives:3, last:0, elapsed:0, spawn:0, enemyFire:1, waveTime:0, shake:0, playerHit:0, muted:false };
const player = { mesh:null, x:0, speed:18, cooldown:0, invulnerable:0 };
const enemies = [], shots = [], enemyShots = [], particles = [], stars = [], keys = new Set();
let audioContext = null;

// Materials and simple procedural geometry keep the game completely asset-free.
const mat = (color, emissive = color) => new THREE.MeshPhongMaterial({ color, emissive, emissiveIntensity: .75, flatShading:true });
const glowLine = (color) => new THREE.LineBasicMaterial({ color, transparent:true, opacity:.7 });
function makeShip(color = COLORS.cyan) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.ConeGeometry(.7, 2.2, 4), mat(color)); body.rotation.x = -Math.PI / 2; group.add(body);
  const wing = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-1.3,0,.35),new THREE.Vector3(0,0,-.9),new THREE.Vector3(1.3,0,.35)]), glowLine(color)); group.add(wing);
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(.19, 8, 6), mat(COLORS.white)); cockpit.position.z = -.55; group.add(cockpit);
  return group;
}
function makeEnemy(type) {
  const group = new THREE.Group(); const color = type === 'boss' ? COLORS.yellow : type === 'elite' ? COLORS.purple : COLORS.pink;
  const shape = type === 'boss' ? new THREE.OctahedronGeometry(1.05) : new THREE.SphereGeometry(type === 'elite' ? .7 : .56, 8, 5);
  const core = new THREE.Mesh(shape, mat(color)); group.add(core);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(type === 'boss' ? 1.25 : .72, .07, 4, 12), mat(COLORS.cyan)); ring.rotation.x = Math.PI/2; group.add(ring);
  if (type === 'boss') { const crown = new THREE.Mesh(new THREE.ConeGeometry(.5,.75,5),mat(COLORS.pink)); crown.position.y=1; group.add(crown); }
  group.userData.core = core; return group;
}
function addStars() {
  const geo = new THREE.BufferGeometry(); const positions = [];
  for (let i=0;i<420;i++) positions.push((Math.random()-.5)*62, (Math.random()-.5)*38, Math.random()*-95);
  geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3)); const starField = new THREE.Points(geo,new THREE.PointsMaterial({color:0x789bff,size:.09,transparent:true,opacity:.8})); scene.add(starField); stars.push(starField);
  const grid = new THREE.GridHelper(70, 35, 0x253a76, 0x111d45); grid.rotation.x=Math.PI/2; grid.position.set(0,-10,-35); grid.material.transparent=true;grid.material.opacity=.3;scene.add(grid);stars.push(grid);
}
function initScene() { addStars(); player.mesh=makeShip(); player.mesh.position.set(0,-8,5); scene.add(player.mesh); }

function resize() { const rect=stageEl.getBoundingClientRect(); const width=Math.max(rect.width,320), height=Math.max(rect.height,360); renderer.setSize(width,height,false); camera.aspect=width/height;camera.updateProjectionMatrix(); }
function formatScore(value) { return String(Math.max(0,value)).padStart(6,'0'); }
function updateHud() { hud.score.textContent=formatScore(game.score);hud.high.textContent=formatScore(Math.max(highScore,game.score));hud.stage.textContent=String(game.stage).padStart(2,'0');hud.lives.textContent='♥'.repeat(game.lives)+'·'.repeat(Math.max(0,3-game.lives)); }
function showScreen(name) { Object.entries(screens).forEach(([key,el])=>{el.hidden=key!==name;el.classList.toggle('active',key===name);}); }
function toast(message) { const el=$('#toast');el.textContent=message;el.classList.remove('show');void el.offsetWidth;el.classList.add('show'); }
function beep(frequency,duration=.08,type='square') { if(game.muted)return; try { audioContext ||= new (window.AudioContext||window.webkitAudioContext)(); const o=audioContext.createOscillator(), g=audioContext.createGain();o.type=type;o.frequency.value=frequency;g.gain.setValueAtTime(.035,audioContext.currentTime);g.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+duration);o.connect(g).connect(audioContext.destination);o.start();o.stop(audioContext.currentTime+duration); } catch (_) {} }
function clearDynamic() { [...enemies,...shots,...enemyShots,...particles].forEach(item=>scene.remove(item.mesh||item));enemies.length=0;shots.length=0;enemyShots.length=0;particles.length=0; }
function startGame() { clearDynamic();game.state='playing';game.score=0;game.stage=1;game.lives=3;game.elapsed=0;game.waveTime=0;player.x=0;player.cooldown=0;player.invulnerable=1.5;player.mesh.visible=true;showScreen(null);updateHud();createWave();beep(440,.16,'sawtooth'); }
function createWave() { clearDynamic(); const rows=3+Math.min(2,Math.floor((game.stage-1)/2)); const cols=7; for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){let type=r===0&&game.stage%3===0?'elite':'basic';const enemy={mesh:makeEnemy(type),x:(c-(cols-1)/2)*3.2,y:7-r*2.2,z:-8-r*.5,baseX:0,row:r,type,phase:Math.random()*6.2,alive:true,diving:false,health:type==='elite'?2:1};enemy.baseX=enemy.x;enemy.mesh.position.set(enemy.x,enemy.y,enemy.z);enemies.push(enemy);scene.add(enemy.mesh);} if(game.stage%3===0){const boss={mesh:makeEnemy('boss'),x:0,y:11,z:-10,baseX:0,row:-1,type:'boss',phase:0,alive:true,diving:false,health:8};boss.mesh.position.set(0,11,-10);enemies.push(boss);scene.add(boss.mesh);toast('⚠ ELITE SWARM DETECTED');} }
function firePlayer() { if(game.state!=='playing'||player.cooldown>0)return; player.cooldown=.22;const mesh=new THREE.Mesh(new THREE.CylinderGeometry(.07,.07,1.1,6),mat(COLORS.cyan));mesh.rotation.x=Math.PI/2;mesh.position.set(player.x,-7.1,4);scene.add(mesh);shots.push({mesh,velocity:30});beep(660,.045); }
function fireEnemy(enemy) { const mesh=new THREE.Mesh(new THREE.SphereGeometry(.12,6,4),mat(COLORS.pink));mesh.position.copy(enemy.mesh.position);scene.add(mesh);enemyShots.push({mesh,velocity:7+game.stage*.35});beep(140,.05,'sawtooth'); }
function explode(position,color=COLORS.pink,big=false) { const amount=big?30:12;for(let i=0;i<amount;i++){const mesh=new THREE.Mesh(new THREE.BoxGeometry(.09,.09,.09),mat(color));mesh.position.copy(position);scene.add(mesh);particles.push({mesh,velocity:new THREE.Vector3((Math.random()-.5)*7,(Math.random()-.5)*7,(Math.random()-.5)*5),life:.35+Math.random()*.5});}beep(big?80:190,big?.25:.1,'sawtooth'); }
function destroyEnemy(enemy) { if(!enemy.alive)return;enemy.health--;explode(enemy.mesh.position,enemy.type==='elite'?COLORS.purple:enemy.type==='boss'?COLORS.yellow:COLORS.pink,enemy.health<=0&&enemy.type==='boss');if(enemy.health>0)return;enemy.alive=false;game.score+=enemy.type==='boss'?1000:enemy.type==='elite'?250:100;updateHud(); }
function loseLife() { if(player.invulnerable>0)return;game.lives--;player.invulnerable=2;explode(player.mesh.position,COLORS.cyan,true);updateHud();if(game.lives<=0){game.state='over';const isNewRecord=game.score>highScore;highScore=Math.max(highScore,game.score);localStorage.setItem(storeKey,String(highScore));$('#finalScore').textContent=formatScore(game.score);$('#newHighScore').hidden=!isNewRecord;showScreen('over');beep(55,.5,'sawtooth');}else{player.mesh.visible=true;toast('SHIP DAMAGED // HOLD FORMATION');beep(95,.25,'sawtooth');} }
function collisions() { for(const shot of shots){for(const enemy of enemies){if(!enemy.alive)continue;if(shot.mesh.position.distanceTo(enemy.mesh.position)<1.1){shot.dead=true;destroyEnemy(enemy);break;}}}for(const shot of enemyShots){if(shot.mesh.position.distanceTo(player.mesh.position)<.9){shot.dead=true;loseLife();}}for(const enemy of enemies){if(enemy.alive&&enemy.mesh.position.distanceTo(player.mesh.position)<1.4){enemy.alive=false;loseLife();}} }
function update(dt) { game.elapsed+=dt;game.waveTime+=dt;player.cooldown=Math.max(0,player.cooldown-dt);player.invulnerable=Math.max(0,player.invulnerable-dt);player.mesh.visible=player.invulnerable<=0||Math.floor(player.invulnerable*10)%2===0;const direction=(keys.has('ArrowRight')||keys.has('d')?1:0)-(keys.has('ArrowLeft')||keys.has('a')?1:0);player.x=THREE.MathUtils.clamp(player.x+direction*player.speed*dt,-13.5,13.5);player.mesh.position.x=player.x;if(keys.has(' ')||keys.has('Spacebar'))firePlayer();
  const sway=Math.sin(game.waveTime*.85)*2.3;for(const enemy of enemies){if(!enemy.alive)continue;enemy.mesh.rotation.y+=dt*(enemy.type==='boss'?1.4:2.5);if(!enemy.diving&&enemy.type!=='boss'&&Math.random()<dt*.018*(1+game.stage*.12)){enemy.diving=true;enemy.diveStart=game.waveTime;enemy.diveX=player.x;}if(enemy.diving){const t=Math.min(1,(game.waveTime-enemy.diveStart)/1.7);enemy.mesh.position.set(THREE.MathUtils.lerp(enemy.baseX+sway,enemy.diveX,t),THREE.MathUtils.lerp(enemy.y, -7,t),THREE.MathUtils.lerp(enemy.z,4,t));if(t>=1){enemy.diving=false;enemy.baseX=enemy.mesh.position.x;}}else{enemy.mesh.position.x=enemy.baseX+sway;enemy.mesh.position.y=enemy.y+Math.sin(game.waveTime*2+enemy.phase)*.16;}if((enemy.diving||enemy.type==='boss')&&Math.random()<dt*.28)fireEnemy(enemy);}
  game.enemyFire-=dt;if(game.enemyFire<=0){const alive=enemies.filter(e=>e.alive);if(alive.length)fireEnemy(alive[Math.floor(Math.random()*alive.length)]);game.enemyFire=Math.max(.3,1.5-game.stage*.06);}
  for(const shot of shots){shot.mesh.position.z-=shot.velocity*dt;if(shot.mesh.position.z<-20)shot.dead=true;}for(const shot of enemyShots){shot.mesh.position.y-=shot.velocity*dt;if(shot.mesh.position.y<-12)shot.dead=true;}for(const p of particles){p.mesh.position.addScaledVector(p.velocity,dt);p.velocity.multiplyScalar(.94);p.life-=dt;p.mesh.material.opacity=Math.max(0,p.life*2);}collisions();
  removeDead(shots);removeDead(enemyShots);for(let i=particles.length-1;i>=0;i--)if(particles[i].life<=0){scene.remove(particles[i].mesh);particles.splice(i,1);}for(let i=enemies.length-1;i>=0;i--)if(!enemies[i].alive){scene.remove(enemies[i].mesh);enemies.splice(i,1);}if(!enemies.length){game.stage++;updateHud();toast(`STAGE ${String(game.stage).padStart(2,'0')} // WAVE INBOUND`);beep(880,.2);setTimeout(()=>{if(game.state==='playing')createWave();},900);}stars[0].rotation.z+=dt*.004; }
function removeDead(list){for(let i=list.length-1;i>=0;i--)if(list[i].dead){scene.remove(list[i].mesh);list.splice(i,1);}}
function render(time=0){requestAnimationFrame(render);const dt=Math.min(.05,(time-game.last)/1000||0);game.last=time;if(game.state==='playing')update(dt);renderer.render(scene,camera);}
function setPaused(paused){if(game.state==='over'||game.state==='start')return;game.state=paused?'paused':'playing';showScreen(paused?'pause':null);if(!paused)beep(520,.08);}
function bindControls(){window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(document.hidden&&game.state==='playing')setPaused(true);});window.addEventListener('keydown',(e)=>{if(['ArrowLeft','ArrowRight',' ','a','d','A','D'].includes(e.key))e.preventDefault();keys.add(e.key);if(e.key==='p'||e.key==='Escape')setPaused(game.state==='playing');if(e.key==='Enter'&&game.state==='start')startGame();});window.addEventListener('keyup',(e)=>keys.delete(e.key));$('#startButton').addEventListener('click',startGame);$('#restartButton').addEventListener('click',startGame);$('#resumeButton').addEventListener('click',()=>setPaused(false));$('#muteButton').addEventListener('click',()=>{game.muted=!game.muted;const b=$('#muteButton');b.setAttribute('aria-pressed',String(game.muted));b.innerHTML=`SOUND <span>${game.muted?'OFF':'ON'}</span>`;});
  const hold=(button,key)=>{button.addEventListener('pointerdown',e=>{e.preventDefault();keys.add(key);button.setPointerCapture?.(e.pointerId);});['pointerup','pointercancel','pointerleave'].forEach(event=>button.addEventListener(event,()=>keys.delete(key)));};hold($('#leftButton'),'ArrowLeft');hold($('#rightButton'),'ArrowRight');$('#fireButton').addEventListener('pointerdown',e=>{e.preventDefault();firePlayer();});stageEl.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'&&game.state==='playing'){const r=stageEl.getBoundingClientRect();player.x=THREE.MathUtils.clamp(((e.clientX-r.left)/r.width-.5)*28,-13.5,13.5);}}); }
initScene();bindControls();resize();updateHud();render();
