// 火球 / Fireball
// Three.js 0.186.1 / WebGL2 / SRGBColorSpace / NoToneMapping
// 將 group 加入場景，在既有遊戲循環呼叫 update(deltaSeconds)，結束時 dispose()。
// 建立後起始 → 持續；由遊戲碰撞呼叫 hit(worldPosition?, worldNormal?)，或 stop() 自然收尾。
// hit() 預設從彈體前端觸發；指定世界座標時將前端對準接觸點，根物件中心可能偏移。
// 持續 update 至 finished 後 dispose()；phase 提供階段。reset() 保留目前位置。
// 單次效果自行結束；不包含碰撞判斷或網站自動展示排程。
// size 控制核心或草葉尺寸；speed 控制視覺動畫速度；detail 控制裝飾或筆觸強度。
// quantity 僅用於支援款的主體總數／每輪數量；density 控制裝飾粒子或植被密度。
// spread 僅用於支援款的散布範圍，預設 1；不改主體大小、數量或演出時間。
// 無外部貼圖、無全畫面後製；不同渲染設定可能影響外觀。
//
// Provided by the user as a drop-in VFX module. createEffect is kept verbatim; the grass and
// utility effect builders it can dispatch to are not used by the fireball (kind 0, variant 0)
// and are stubbed at the bottom of this file to keep the bundle small.

import * as THREE from 'three';

// 預覽與單檔匯出共用；全部材質以程式生成，不依賴外部貼圖或後製。
export function createEffect(spec, options = {}) {
  const kind = spec.kind;
  const variant = spec.variant;
  const quantityDefault = ({"0:3":3,"1:1":4,"1:3":6,"3:1":12,"3:3":9,"3:4":5,"2:4":9,"2:5":3,"2:6":4,"2:7":3,"3:7":10,"2:8":7,"3:8":13,"7:0":7,"7:1":4,"1:5":9,"3:9":14,"3:10":9,"1:6":8,"9:0":6})[`${kind}:${variant}`] ?? 1;
  const toon = spec.renderStyle === 'toon' && (kind === 3 || kind === 4);
  const cap = Math.min(kind === 5 ? 128 : 1024, Math.max(1, spec.maxParticles));
  const group = new THREE.Group();
  group.name = spec.id;
  let settings = { color: spec.color, size: 1, density: spec.defaultDensity ?? 0.5, speed: 1, detail: 1, ...(spec.quantity ? {quantity:spec.quantity.default} : {}), ...(spec.spread ? {spread:spec.spread.default} : {}), ...options };
  let time = 0, disposed = false, travelSpeed = 0, endpoints = null, count = 0;
  const direction = new THREE.Vector3(1, 0, 0);
  const axis = new THREE.Vector3(1, 0, 0);
  const scratch = new THREE.Vector3();
  const geometries = new Set();
  const materials = new Set();
  const allocations = [];
  const animated = [];
  const coreParts=[];
  const stagePlanes=[];
  const stageOpaque=[];
  function corePart(object,axes="xyz",pivot=0){coreParts.push({object,axes,pivot,scale:object.scale.clone(),position:object.position.clone()});return object;}
  const uniforms = {
    uTime: { value: 0 }, uColor: { value: new THREE.Color() },
    uQuantity: { value: quantityDefault }, uSpread: { value: 1 }, uStretch: { value: 1 }, uSize: {value:1}, uDetail:{value:1},
  };
  // Lifecycle time is visual time. World travel remains in unscaled seconds.
  const durations = {0:[.35,.8],1:[variant===2?1.6:.4,.6],2:[.7,1],4:[1.1,1.4],5:[.5,1.2]};
  const fallback = spec.burst ? [spec.duration*.1,spec.duration*.45] : durations[kind] ?? [.3,.8];
  const lifecycle = {start:Math.max(.001,Number(spec.lifecycle?.start)||fallback[0]),end:Math.max(.001,Number(spec.lifecycle?.end)||fallback[1])};
  let phase='starting', endTime=0, stopTime=-1, endStart=1, impact=false;
  const lifeUniforms={uLifeStage:{value:0},uLifeStart:{value:0},uLifeEnd:{value:0},uLifeOrigin:{value:1},uStopTime:{value:-1},uEndDuration:{value:lifecycle.end},uImpact:{value:0},uEmitterTime:{value:0}};
  const clipToGroup=new THREE.Matrix4(),groupToClip=new THREE.Matrix4();
  let lastRenderFrame=-1,lastCamera=null;
  // Stage deformation is applied to the already animated surface in group space.
  // The active path returns immediately, retaining the original shader output.
  const lifeVertex=`
    uniform float uLifeStage,uLifeStart,uLifeEnd,uLifeOrigin;
    uniform mat4 uClipToGroup,uGroupToClip;
    varying vec3 vStagePosition;varying float vStagePart;
    vec3 stageShape(vec3 p,float s,float e,float part){
      float grow=s*s*(3.0-2.0*s),curl=(1.0-grow);
      #if KIND == 0
        float tail=1.0-smoothstep(-1.4,.25,p.x);
        #if VARIANT == 0
          p.yz*=mix(.22,1.0,grow);p.x=mix(p.x*.38-.16,p.x,grow);
          p.y+=sin(p.x*4.5+s*7.0)*curl*.15;
        #elif VARIANT == 1
          p.x*=mix(1.3,1.0,grow);p.yz*=mix(.08,1.0,grow);
        #elif VARIANT == 2 || VARIANT == 4
          float assemble=ceil((atan(p.z,p.y)+3.14159)*3.0)*.028;
          p.yz*=1.0+curl*(.8+assemble);p.x-=curl*(.2+assemble);
        #elif VARIANT == 3
          p.yz*=1.0+curl*.8;p.x+=sin(p.y*7.0)*curl*.4;
        #elif VARIANT == 5
          p.z+=sin(p.x*4.0)*curl*.75;p.x-=curl*.5;
        #else
          p.yz*=1.0+curl*.85;float turn=curl*2.4;
          p.yz=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.yz;
        #endif
        p.x-=e*tail*1.6;p.yz*=1.0-e*.75;
      #elif KIND == 1
        // Range is revealed in fragments; endpoints never change coordinates.
        p.yz*=mix(.35,1.0,grow)*(1.0-e*.7);
      #elif KIND == 2
        float r=length(p.xz),a=atan(p.z,p.x);
        float cell=floor((a+3.14159)*3.0);float stagger=smoothstep(.04+fract(part*.37+cell*.13)*.2,.9,e);
        #if VARIANT == 0
          p.y+=curl*(.15+sin(a*5.0)*.08);float returnTime=smoothstep(.0,.72,e);float turn=returnTime*.8;p.xz=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.xz;p.xz*=1.0-returnTime*.95;p.y=mix(p.y,.06,returnTime)+sin(returnTime*3.14159)*.32;
        #elif VARIANT == 1
          p.y*=grow*(1.0-stagger*.8);p.y+=sin(stagger*3.14159)*.16;p.xz*=1.0+stagger*.1;
        #elif VARIANT == 2
          vec2 cellCenter=(floor(p.xz*2.5)+.5)/2.5;vec2 local=p.xz-cellCenter;float tumble=stagger*(1.0+fract(cell*.71)*2.0);p.xz=cellCenter*(1.0+stagger*.65)+local*cos(tumble);p.y+=local.x*sin(tumble)+sin(stagger*3.14159)*(.25+fract(cell*.71)*.45)-stagger*stagger*.35;p.xz*=mix(.7,1.0,grow);
        #elif VARIANT == 3
          p.y*=grow;float release=smoothstep(fract(cell*.37)*.2,.72,e);p*=1.0+release*.4;p.y+=release*(.12+max(0.0,p.y)*.4);
        #elif VARIANT == 4
          p.y*=grow;p.xz*=1.0+stagger*.32;p.y-=stagger*stagger*max(0.0,p.y)*.9;p.x+=sin(part*3.1)*stagger*.18;
        #elif VARIANT == 5
          p.y*=grow;float release=smoothstep(.02+fract(part*.31)*.2,.72,e);float loosen=release*(.4+max(0.0,p.y)*.7);p.xz+=vec2(cos(part*2.4),sin(part*2.4))*loosen;p.y+=sin(release*3.14159)*.28-release*release*.55;
        #elif VARIANT == 6
          float height=max(0.0,p.y);float retract=smoothstep(.0,.9,e);float bend=retract*height*2.1;float turn=curl*2.7+retract*.4;
          p.xz=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.xz;p.xz*=1.0-retract*.3;p.xz+=vec2(cos(a),sin(a))*(cos(bend)-1.0)*height*.45;
          p.y=grow*(height*cos(bend)*(1.0-retract*.5)+min(p.y,0.0));
        #elif VARIANT == 7
          float slide=smoothstep(.04+(.5+.5*sin(a*3.0))*.25,.9,e);p.y*=grow*(1.0-slide);p.y+=sin(slide*3.14159)*(.08+.06*sin(a*2.0));p.xz*=1.0-slide*.83;
        #else
          float pop=smoothstep(.08+fract(part*.41)*.25,.65+fract(part*.41)*.25,e);p.y*=grow*(1.0-pop*.85);p.xz*=mix(.55,1.0,grow)*(1.0+sin(pop*3.14159)*.65);
        #endif
      #elif KIND == 3
        float radius=length(p.xz),angle=atan(p.z,p.x);
        #if VARIANT == 2
          float crest=sin(radius*5.0-e*5.0+sin(angle*5.0));p.y+=crest*sin(e*3.14159)*.18;p.xz*=1.0+e*.12;
        #elif VARIANT == 4
          float h=max(0.0,p.y+1.3);p.z+=sin(h*4.0-e*6.0)*e*.4;p.y+=cos(h*3.5-e*5.0)*e*.24;p.x*=1.0+e*.2;
        #elif VARIANT == 5
          p.x+=sin(p.y*25.0+floor(e*17.0))*e*.07;p.z+=sin(p.y*18.0-floor(e*13.0))*e*.06;
        #elif VARIANT == 6
          float h=max(0.0,p.y+1.3);float roll=e*3.8+radius*2.0;p.y+=sin(roll)*h*.7;p.xz*=1.0+sin(roll)*h*.15;
        #elif VARIANT == 7
          float ray=length(p);p*=1.0-e*.22;p.y+=sin(ray*7.0+e*8.0)*e*.04;
        #endif
      #elif KIND == 4
        float h=clamp((p.y+1.4)/3.4,0.0,1.0);
        // 大範圍捲流向內聚攏；正常持續及收尾（s=1）保持原來的變形。
        float gather=curl*(1.0-smoothstep(0.0,.6,e));
        p.y=-1.4+(p.y+1.4)*(1.0+gather*.10);
        float turn=gather*(1.0-h)*.55-e*.45;p.xz=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*p.xz;p.xz*=1.0+gather*.45+e*.18;
        #if VARIANT == 1
          p.y=max(-1.38,p.y-e*e*h*.7);
        #endif
      #elif KIND == 5
        #if VARIANT == 1
          p.xz*=mix(.18,1.0,grow)*(1.0+e*.18);
        #else
          p.y=-1.4+(p.y+1.4)*mix(.2,1.0,grow);
        #endif
      #endif
      return p;
    }
  `;
  const lifeFragment=`
    uniform float uLifeStage,uLifeStart,uLifeEnd,uLifeOrigin,uImpact;
    varying vec3 vStagePosition;varying float vStagePart;
    float phaseCoverage(vec3 p){
      float s=uLifeStart,e=uLifeEnd;
      float a=atan(p.z,p.x),r=length(p.xz);
      float start=1.0,end=1.0;
      #if KIND == 0
        #if VARIANT == 0
          float curl=sin(p.x*6.0+p.y*5.0+s*9.0)*.06;
          start=smoothstep(0.0,.18,s)*smoothstep(-.12,.12,s-(.15+clamp(-p.x,0.0,3.0)*.2+curl));
        #elif VARIANT == 1
          start=smoothstep(.0,.12,s)*smoothstep(-.1,.1,s-abs(p.x)*.24);
        #elif VARIANT == 2 || VARIANT == 4
          start=smoothstep(-.08,.08,s-(.12+fract(atan(p.z,p.y)*1.7)*.56));
        #elif VARIANT == 3
          start=smoothstep(-.12,.12,s-(.1+fract(p.x*.8+p.y)*.55));
        #elif VARIANT == 5
          start=smoothstep(-.13,.13,s-(.15+clamp(-p.x,0.0,2.0)*.25));
        #else
          start=smoothstep(-.13,.13,s-(.1+fract(atan(p.z,p.y)*.5-p.x*.3)*.6));
        #endif
        end=1.0-smoothstep(0.0,uImpact>.5?.28:.9,e);
      #elif KIND == 1
        float x=clamp((p.x+2.4)/4.8,0.0,1.0);
        start=smoothstep(-.08,.08,s*1.16-.08-x);
        end=smoothstep(-.14,.05,x-e*1.22+.12)*(1.0-smoothstep(.78,1.0,e));
      #elif KIND == 2
        float pattern=0.0;
        #if VARIANT == 0
          pattern=.1+r*.25+sin(a*5.0)*.08;
        #elif VARIANT == 1
          pattern=.12+fract(a/6.28318*5.0)*.22+r*.2;
        #elif VARIANT == 2
          pattern=.1+r*.25+abs(sin(a*3.0))*.1;
        #elif VARIANT == 3
          pattern=.12+max(abs(p.x),abs(p.z))*.27+max(0.0,p.y)*.18;
        #elif VARIANT == 4
          pattern=.1+fract(floor(p.x*3.0)+floor(p.z*3.0)*.38)*.35+max(0.0,p.y)*.2;
        #elif VARIANT == 5
          pattern=.14+fract(a/6.28318*3.0)*.3+max(0.0,p.y)*.2;
        #elif VARIANT == 6
          pattern=.08+r*.18+max(0.0,p.y)*.25;
        #elif VARIANT == 7
          pattern=.1+(1.7-r)*.25+abs(sin(a*1.5))*.12;
        #else
          pattern=.12+r*.2+sin(a*3.0)*.1;
        #endif
        pattern=clamp(pattern,.08,.75);
        start=smoothstep(-.08,.08,s-pattern);
        end=1.0-smoothstep(-.12,.12,e-(.18+pattern*.75));
        #if VARIANT == 0
          end=1.0-smoothstep(.64,.98,e);
        #elif VARIANT == 5 || VARIANT == 6 || VARIANT == 7
          end=1.0-smoothstep(.55,.98,e);
        #endif
        if(e>0.0){
          #if VARIANT == 1
            float ash=.5+.5*sin(p.x*31.0+p.z*23.0+sin(p.x*17.0)*3.0);end*=smoothstep(e*.7-.1,e*.7+.12,ash);
          #elif VARIANT == 3
            float sector=fract(a*1.4324);float gap=smoothstep(.03,.38,e)*.22;end*=smoothstep(gap,gap+.025,sector)*(1.0-smoothstep(1.0-gap-.025,1.0-gap,sector));
          #elif VARIANT == 2 || VARIANT == 4
            vec2 tile=abs(fract(p.xz*2.5)-.5);float crack=max(tile.x,tile.y);end*=1.0-smoothstep(.5-e*.25,.51-e*.25,crack);
          #elif VARIANT == 7
            float grain=.5+.5*sin(p.x*19.0+sin(p.z*15.0)*2.0);end*=mix(1.0,smoothstep(e*.65-.12,e*.65+.15,grain),smoothstep(.5,.9,e));
          #elif VARIANT == 8
            float pop=smoothstep(.08+fract(vStagePart*.41)*.25,.65+fract(vStagePart*.41)*.25,e);end*=1.0-smoothstep(.015,.08,max(0.0,p.y)-(.9-pop*1.5));
          #endif
        }
      #elif KIND == 3
        if(e>0.0){
          #if VARIANT == 2
            float breakUp=.5+.5*sin(a*7.0+sin(a*3.0)+p.y*5.0);end=smoothstep(e*.6-.1,e*.6+.12,breakUp);
          #elif VARIANT == 4
            float flame=.5+.5*sin(p.x*7.0+sin(p.y*5.0-e*9.0)*2.0+p.z*3.0);end=smoothstep(e*.82-.08,e*.82+.09,flame);
          #elif VARIANT == 5
            float segment=floor(p.y*3.0);float discharge=.5+.5*sin(segment*4.7+floor(e*13.0)*2.9);end=mix(smoothstep(.32,.55,discharge)*(1.0-smoothstep(.1,.55,e)),1.0,1.0-smoothstep(-.9,-.3,p.y));
          #elif VARIANT == 6
            float foam=.5+.5*sin(a*11.0+sin(p.y*9.0+e*8.0)+r*4.0);end=smoothstep(e*.88-.08,e*.88+.12,foam);
          #elif VARIANT == 7
            float ray=length(p);float streak=.5+.5*sin(a*9.0+floor(e*9.0)*2.4);end=1.0-smoothstep((1.0-e)*3.0+.2,(1.0-e)*3.0+.5,ray);end*=mix(.2,1.0,streak);
          #endif
        }
      #elif KIND == 4
        float h=clamp((p.y+1.4)/3.4,0.0,1.0);
        start=smoothstep(0.0,.13,s);
        end=1.0-smoothstep(.45,1.0,e);
      #elif KIND == 5
        start=smoothstep(.0,.25,s);
        end=1.0-smoothstep(.35,1.0,e);
      #endif
      return start*end;
    }
  `;
  function installLifecycle(){
    if(spec.burst&&!(kind===3&&variant===2))return;
    for(const material of materials){
      if(material.userData.ownLifecycle)continue;
      if(kind===0&&!material.transparent)stageOpaque.push(material);
      const part=material.vertexShader.includes('attribute float aPhase')?'aPhase':material.vertexShader.includes('attribute vec4 seed')?'seed.x*37.0':'0.0';
      const freezeEmitter=kind===2&&[0,2,3,5,6,7,8].includes(variant);
      if(freezeEmitter){material.vertexShader=material.vertexShader.replace(/\buTime\b/g,'uEmitterTime');material.fragmentShader=material.fragmentShader.replace(/\buTime\b/g,'uEmitterTime');}
      const vertex=material.vertexShader.replace(/void\s+main\s*\(\s*\)/,'void steadyMain()');
      const fragment=material.fragmentShader.replace(/void\s+main\s*\(\s*\)/,'void steadyMain()');
      material.uniforms={...material.uniforms,...lifeUniforms,uClipToGroup:{value:clipToGroup},uGroupToClip:{value:groupToClip}};
      material.vertexShader=lifeVertex+vertex+`
        void main(){steadyMain();vStagePosition=vec3(0.0);vStagePart=${part};if(uLifeStage==1.0)return;
          vec4 p=uClipToGroup*gl_Position;p/=p.w;vStagePosition=p.xyz;
          gl_Position=uGroupToClip*vec4(stageShape(p.xyz,uLifeStart,uLifeEnd,vStagePart),1.0);
        }`;
      material.fragmentShader=lifeFragment+fragment+`
        void main(){steadyMain();if(uLifeStage==1.0)return;
          float coverage=phaseCoverage(vStagePosition);
          if(coverage<.004)discard;gl_FragColor.a*=coverage;
          #if KIND == 1 && VARIANT == 4
            float radius=length(vStagePosition.yz);float core=1.0-smoothstep(.04,.22,radius);float atEnd=smoothstep(1.65,2.05,abs(vStagePosition.x));
            float petal=floor((atan(vStagePosition.z,vStagePosition.y)+3.14159)*.955);float release=smoothstep(.15+fract(petal*.381)*.3,.85,uLifeEnd);
            gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(1.0,.97,.81),core*.75);
            gl_FragColor.a*=mix(.55+.45*core,1.0-release,atEnd);
            gl_FragColor.a*=1.0-atEnd*smoothstep(.35,.9,uLifeEnd)*smoothstep(.05,.55,radius);
          #elif KIND == 2 && VARIANT == 1
            gl_FragColor.rgb*=1.0-uLifeEnd*.75;
          #elif KIND == 4 && VARIANT == 2
            gl_FragColor.rgb*=1.0-uLifeEnd*.6;
          #elif KIND == 3 && VARIANT == 6
            gl_FragColor.rgb=mix(gl_FragColor.rgb,vec3(.8,.94,1.0),uLifeEnd*.65);
          #endif
        }`;
    }
    if(kind===2)for(const object of group.children){
      if(object.geometry.type==='PlaneGeometry'){
        const old=object.geometry,p=old.parameters,split=new THREE.PlaneGeometry(p.width,p.height,24,24),combined=new THREE.BufferGeometry();
        const offset=old.attributes.position.count;
        for(const key of ['position','normal','uv'])combined.setAttribute(key,new THREE.Float32BufferAttribute([...old.attributes[key].array,...split.attributes[key].array],old.attributes[key].itemSize));
        combined.setIndex([...old.index.array,...Array.from(split.index.array,x=>x+offset)]);
        stagePlanes.push({geometry:combined,steady:old.index.count,transition:split.index.count});
        object.geometry=combined;geometries.delete(old);old.dispose();split.dispose();geometries.add(combined);
      }
    }
    for(const object of group.children){object.onBeforeRender=(renderer,scene,camera)=>{
      if(phase==='active')return;
      if(lastRenderFrame!==renderer.info.render.frame||lastCamera!==camera){
        groupToClip.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).multiply(group.matrixWorld);
        clipToGroup.copy(groupToClip).invert();lastRenderFrame=renderer.info.render.frame;lastCamera=camera;
      }
      object.material.uniformsNeedUpdate=true;
    };}
  }

  const noise = `
    float hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
    float noise2(vec2 p) {
      vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
      return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1)),f.x),f.y);
    }
    float fbm(vec2 p) { return noise2(p)*0.57+noise2(p*2.07+3.1)*0.29+noise2(p*4.13-1.7)*0.14; }
    float band(float x,float width) { return 1.0-smoothstep(width,width+0.004,abs(x)); }
    #define PI 3.14159265359
  `;
  // 投射物專用的三段自發光 Toon 色階；不變更其餘種類的材質。
  const projectileToon=`
    float toonStep(float edge,float x){float aa=max(fwidth(x),.008);return smoothstep(edge-aa,edge+aa,x);}
    vec3 toonShade(vec3 tint,float light){
      vec3 c=mix(tint*.28,tint*1.08,toonStep(.40,light));
      return mix(c,mix(tint,vec3(1.0),.53)*1.15,toonStep(.69,light));
    }
  `;
  // 解析雜訊梯度用於旋度流場與煙霧受光，避免有限差分重複取樣。
  const flow = `
    vec3 noiseGradient(vec2 p){
      vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f),du=6.0*f*(1.0-f);
      float a=hash(i),b=hash(i+vec2(1,0)),c=hash(i+vec2(0,1)),d=hash(i+vec2(1,1));
      return vec3(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),du.x*mix(b-a,d-c,u.y),du.y*mix(c-a,d-b,u.x));
    }
    vec3 curlFlow(vec3 p,float t){
      // A=(N(y,z),N(z,x),N(x,y)) 的解析 curl；所有元件取樣同一空間。
      vec3 ax=noiseGradient(p.yz+vec2(7.3-t*0.22,1.7+t*0.11));
      vec3 ay=noiseGradient(p.zx+vec2(13.1+t*0.13,5.4-t*0.19));
      vec3 az=noiseGradient(p.xy+vec2(2.9-t*0.16,17.2+t*0.14));
      return vec3(az.z-ay.y,ax.z-az.y,ay.z-ax.y)*0.65;
    }
  `;
  // 參考官方火焰的 UV 扭曲、雙層侵蝕與色階映射；全部採程式雜訊。
  const flame = `
    vec3 flameErosion(vec2 uv,float t,float seed){
      vec2 p=vec2(uv.x+uv.y*0.65,uv.y);
      float warp=noise2(p*vec2(3.1,2.7)+vec2(seed,t*-0.31));
      p.x+=(warp-0.5)*0.6;
      float broad=noise2(p*vec2(4.0,2.2)+vec2(seed*3.7,-t*0.85));
      float fine=noise2(p*vec2(10.5,5.0)+vec2(seed*7.1,-t*1.35));
      float erosion=broad*0.72+fine*0.28;
      float interior=1.0-abs(uv.x*2.0-1.0);
      float shape=interior-(1.0-erosion)*0.67;
      float aa=max(fwidth(shape)*0.8,0.018);
      float mask=smoothstep(-aa,aa+0.07,shape);
      float heat=clamp(shape*0.9+broad*0.25,0.0,1.0);
      float edge=exp(-abs(shape)*24.0)*smoothstep(0.28,0.58,erosion);
      return vec3(mask,heat,edge);
    }
    vec3 flameColor(vec3 tint,float heat){
      vec3 c=mix(tint*0.065,tint*1.35,smoothstep(0.06,0.48,heat));
      return mix(c,tint*1.6+vec3(1.0,0.85,0.50),smoothstep(0.48,0.84,heat));
    }
  `;
  const smokeLight = `
    vec2 smokeOptics(vec2 q,vec2 densityGradient,float density,vec3 lightDir){
      float dome=sqrt(max(0.015,1.0-dot(q,q)));
      vec3 n=normalize(vec3(q-densityGradient*0.13,dome));
      float wrap=clamp(dot(n,lightDir)*0.7+0.3,0.0,1.0);
      float thickness=dome*(0.3+density*1.1);
      float transmission=exp(-thickness*1.7);
      float rim=pow(1.0-dome,2.0)*wrap*0.20;
      return vec2((0.16+wrap*0.70)*mix(0.55,1.0,transmission)+rim,1.0-exp(-thickness*1.8));
    }
  `;
  const output = `
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  `;
  const surfaceVertex = `
    varying vec2 vUv;
    void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}
  `;
  // 新版材質僅供獨立 Toon 爆炸／旋風使用，原款不改色彩或透明度路徑。
  const styleToon = `
    float styleStep(float edge,float value){float aa=max(fwidth(value),.012);return smoothstep(edge-aa,edge+aa,value);}
    vec3 styleColor(vec3 tint,float light){
      vec3 c=mix(tint*.22,tint*.72,styleStep(.38,light));
      return mix(c,mix(tint,vec3(1.0),.38)*1.04,styleStep(.70,light));
    }
    vec3 styleHeat(vec3 tint,float heat){
      vec3 c=mix(tint*.24,tint*1.05,styleStep(.38,heat));
      return mix(c,mix(tint,vec3(1.0,.88,.51),.62),styleStep(.70,heat));
    }
  `;
  function shader(fragmentShader, vertexShader = surfaceVertex, extra = {}, additive = true, defines = {}) {
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, ...lifeUniforms, ...extra },
      defines: { KIND: kind, VARIANT: variant, TOON: toon ? 1 : 0, ...defines },
      vertexShader: "uniform float uSize;\n"+vertexShader, fragmentShader: "uniform float uDetail;\n"+(toon?styleToon:"")+fragmentShader, transparent: true, depthWrite: false,
      side: THREE.DoubleSide,
      blending: additive && !toon ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    materials.add(material);
    return material;
  }
  function mesh(geometry, material, order = 1) {
    geometries.add(geometry);
    const object = new THREE.Mesh(geometry, material);
    object.frustumCulled = false;
    object.renderOrder = order;
    group.add(object);
    return object;
  }
  function instanced(base, maximum, weight, material, order = 1) {
    const geometry = new THREE.InstancedBufferGeometry();
    if (base.index) geometry.setIndex(base.index.clone());
    for (const key of Object.keys(base.attributes)) geometry.setAttribute(key,base.attributes[key].clone());
    base.dispose();
    const seeds = new Float32Array(maximum*4);
    // index 僅相容舊版傳入的 spec；新目錄與匯出一律使用明確 seed。
    let state = (spec.seed ?? ((spec.index ?? 0)+1)*9187) + allocations.length*311;
    for(let i=0;i<seeds.length;i++) {
      state=(state*1664525+1013904223)>>>0;
      seeds[i]=state/4294967296;
    }
    geometry.setAttribute('seed',new THREE.InstancedBufferAttribute(seeds,4));
    allocations.push({geometry,weight,maximum});
    return mesh(geometry,material,order);
  }
  const particleVertex = `
    attribute vec4 seed;
    uniform float uStopTime,uEndDuration,uQuantity,uSpread;
    uniform float uTime;
    uniform float uStretch;
    varying vec2 vUv;
    varying float vAlpha;
    varying float vSeed;
    varying float vLife;
    varying float vLight;
    ${noise}
    ${flow}
    varying vec3 vKeyLight;
    void main(){
      vKeyLight=normalize(mat3(viewMatrix)*vec3(-0.45,0.8,0.55));
      vUv=uv;vSeed=seed.w;vLight=1.0;
      float t=uTime,a=seed.x*PI*2.0,r=sqrt(seed.z);
      float life=fract(seed.y+t*0.35);
      vec3 p=vec3(0.0);vec2 shape=vec2(1.0);
      float size=0.05+seed.w*0.06;
      vAlpha=0.8;vLife=life;
      #if CLOUD == 1
        #if KIND == 3
          float age=clamp(t/2.8,0.0,1.0);
          float rise=1.0-exp(-t*4.0);
          float crown=step(0.35,seed.y);
          float expansion=(0.25+rise*1.2)*(0.25+seed.z*0.75);
          p=vec3(cos(a)*expansion*crown,-1.36+rise*(0.5+seed.y*2.45)+age*0.3,sin(a)*expansion*crown);
          p.xz+=vec2(sin(t*1.5+a),cos(t*1.7+a))*age*0.25;
          size=(0.3+rise*0.85)*(0.6+seed.w*0.7);
          vAlpha=smoothstep(0.02,0.18,t)*pow(1.0-age,1.2)*0.72;
          vLife=age;vLight=max(0.0,1.0-t*0.65)*(1.0-crown*seed.y*0.5);
          #if VARIANT == 1
            p=vec3(cos(a)*r*(0.3+age*1.5),-1.3+rise*(seed.y*0.6)+age*0.4,sin(a)*r*(0.3+age*1.5));size*=0.6;vAlpha*=0.28;
          #elif VARIANT == 2
            float front=(1.0-exp(-t*2.3))*2.55;float scatter=front*(0.35+seed.z*0.7);p=vec3(cos(a)*scatter,-1.35+sin(age*PI)*(0.12+seed.y*0.40),sin(a)*scatter);size*=0.65;shape=vec2(1.7,0.65);vAlpha*=0.42;
          #elif VARIANT == 3
            p.xz*=1.5;p.y=-1.3+age*0.6+seed.y*0.35;size*=0.75;vAlpha*=0.55;
          #endif
        #else
          float h=uStopTime<0.0?fract(seed.y+t*0.15):min(1.0,fract(seed.y+uStopTime*0.15)+(t-uStopTime)/uEndDuration);
          float spread=0.18+pow(h,0.8)*0.7;
          p=vec3(cos(a+h*4.0)*r*spread+sin(h*5.0+t*0.4)*0.25,h*3.5-1.4,sin(a+h*4.0)*r*spread);
          size=(0.48+h*0.95)*(0.75+seed.w*0.45);
          vAlpha=sin(h*PI)*0.5;vLife=h;
          #if VARIANT == 1
            p=vec3(cos(a+t*0.08)*r*2.0,-1.12+seed.y*0.45,sin(a+t*0.08)*r*1.6);
            size=0.9+seed.w*1.0;shape=vec2(1.5,0.6);vAlpha=0.23;vLife=seed.y;
          #elif VARIANT == 2
            h=uStopTime<0.0?fract(seed.y+t*0.48):min(1.0,fract(seed.y+uStopTime*0.48)+(t-uStopTime)/uEndDuration);
            p=vec3(cos(a+h*7.0)*h*h*0.85,h*3.6-1.4,sin(a+h*7.0)*h*h*0.65);
            size=0.18+h*0.9;shape=vec2(1.0,1.25);vAlpha=sin(h*PI)*0.34;vLife=h;
          #elif VARIANT == 3
            float age=clamp(t/3.5,0.0,1.0),expand=1.0-exp(-t*3.2);
            p=vec3(cos(a)*r*expand*1.55,-0.8+seed.y*expand*1.6+age*0.6,sin(a)*r*expand*1.55);
            size=(0.3+expand*0.85)*(0.6+seed.w*0.6);
            vAlpha=smoothstep(0.0,0.15,t)*pow(1.0-age,1.5)*0.6;vLife=age;
          #endif
        #endif
      #else
        #if KIND == 0
          life=fract(seed.y+t*0.65);
          p=vec3(0.85-life*3.6,sin(a)*r*(0.05+life*0.38),cos(a)*r*(0.05+life*0.38));
          size=0.04+seed.w*0.1;vAlpha=pow(1.0-life,1.5);shape=vec2(2.6,0.6);
          #if VARIANT == 0
            p=vec3(0.65-life*(2.8+seed.z*0.7),sin(a)*r*(0.16+life*0.50),cos(a)*r*(0.16+life*0.50));p.y+=sin(life*9.0-t*5.0+a)*life*0.24;size=0.018+seed.w*0.052;vAlpha=sin(life*PI)*pow(1.0-life,1.2)*0.65;shape=vec2(2.3,0.45);
          #elif VARIANT == 1
            p.yz*=0.9;shape=vec2(4.8,0.3);p.yz+=vec2(cos(a),sin(a))*sin(life*PI)*0.14;vAlpha*=0.2+0.8*step(0.45,sin(life*24.0+t*12.0+seed.z*9.0));
          #elif VARIANT == 2
            shape=vec2(2.2,0.6);p.yz*=1.25;p.y-=life*life*0.4;size*=0.42;vAlpha*=0.35+0.35*pow(max(0.0,sin(t*4.0+seed.z*31.0)),6.0);
          #else
            float spiral=life*12.0-t*3.0+(uQuantity==3.0?floor(seed.x*3.0)*2.094:floor(seed.x*uQuantity)*6.283185307/uQuantity);
            p.yz=vec2(cos(spiral),sin(spiral))*((0.26*mix(uSize,1.0,smoothstep(0.0,0.35,life))+life*0.16)*uSpread)+p.yz*0.07;
            shape=vec2(2.0,0.6);
          #endif
        #elif KIND == 1
          float phase=fract(seed.y+t*1.7);
          if(seed.x<0.26){
            p=vec3(-2.4+phase*0.45/uStretch,cos(a)*phase*0.4,sin(a)*phase*0.4);
            vAlpha=1.0-phase;size=0.04;shape=vec2(2.0,0.65);
          }else if(seed.x>0.58){
            float spread=phase*(0.3+seed.z*0.8);
            p=vec3(2.4-phase*(0.2+seed.w*0.65)/uStretch,cos(a)*spread,sin(a)*spread);
            vAlpha=pow(1.0-phase,1.3);shape=vec2(1.0,3.0);size=0.025+seed.w*0.045;
          }else{
            p=vec3((phase-0.5)*4.8,cos(a+t*4.0)*0.12*r,sin(a+t*4.0)*0.12*r);
            vAlpha=0.6;shape=vec2(2.7,0.5);
          }
          #if VARIANT == 2
            float cycle=t,charge=min(cycle/1.52,1.0),release=smoothstep(1.52,1.60,cycle);
            if(seed.x<0.58){float incoming=fract(seed.y+t*(0.45+charge*0.6));float radius=(1.0-incoming)*(0.35+seed.z*0.75);float angle=a-t*2.0;p=vec3(-2.4-(1.0-incoming)*0.7/uStretch,cos(angle)*radius*uSize,sin(angle)*radius*uSize);vAlpha=sin(incoming*PI)*(0.25+charge*0.75)*(1.0-release*0.4);shape=vec2(2.2,0.5);}
            else{vAlpha*=release;size*=0.7+release*0.6;p.yz*=1.0+release*0.35;}
          #elif VARIANT == 3
            p.yz+=sin(vec2(seed.z*41.0,seed.w*33.0)+floor(t*15.0))*0.1;
          #endif
      #elif KIND == 2
          float spin=a+t*0.15;
          p=vec3(cos(spin)*r*1.85,life*1.4,sin(spin)*r*1.85);
          vAlpha=sin(life*PI)*0.55;size=0.04+seed.w*0.055;
          #if VARIANT == 1
            p.y=life*(0.3+r*0.7);p.xz+=vec2(sin(t*2.0+a),cos(t*2.3+a))*life*0.12;shape=vec2(0.8,3.6);size=0.07+seed.w*0.10;
          #elif VARIANT == 2
            p.y=0.08+life*0.4;p.xz*=0.88+0.12*sin(life*PI);shape=vec2(1.0);vAlpha*=0.5+0.5*pow(max(0.0,sin(t*2.0+seed.z*29.0)),4.0);
          #elif VARIANT == 3
            p=vec3(cos(spin)*sin(seed.y*PI*0.5),cos(seed.y*PI*0.5),sin(spin)*sin(seed.y*PI*0.5))*1.85;
            vAlpha=0.25+0.2*sin(t*2.0+seed.z*6.0);
          #endif
        #elif KIND == 3
          float age=clamp(t/2.8,0.0,1.0);
          float dt=max(0.0,t-seed.w*0.1);
          float speed=0.4+seed.z*1.6;
          p=vec3(cos(a)*speed*dt,-1.35+(2.5+seed.y*3.3)*dt-2.5*dt*dt,sin(a)*speed*dt);
          p.y=max(-1.36,p.y);vAlpha=pow(1.0-age,1.7)*0.65;size=0.018+seed.w*0.045;shape=vec2(0.6,2.5);
          #if VARIANT == 1
            float ray=floor(seed.x*8.0)/8.0*PI*2.0;p=vec3(cos(ray)*dt*speed*0.8,-1.35+dt*(3.0+seed.y*3.5),sin(ray)*dt*speed*0.8);shape=vec2(0.3,6.0);vAlpha*=1.0-smoothstep(0.35,1.25,t);
            #if TOON == 1
              vec3 discharge=normalize(vec3(cos(a),.6+seed.y*1.8,sin(a)));
              p=discharge*(.15+dt*(2.0+seed.z*3.0));p.y-=1.2;
              shape=vec2(3.2,.3);vAlpha*=smoothstep(.06,.13,t);
            #endif
          #elif VARIANT == 2
            p.xz*=1.7;p.y=-1.35+(1.2+seed.y*2.2)*dt-2.5*dt*dt;p.y=max(-1.36,p.y);size*=0.8;shape=vec2(1.0);vAlpha*=0.4;
          #elif VARIANT == 3
            size*=0.85;shape=vec2(0.7,1.8);
          #endif
        #elif KIND == 4
          float h=uStopTime<0.0?fract(seed.y+t*.3):min(1.0,fract(seed.y+uStopTime*.3)+(t-uStopTime)*.55),spin=h*9.6-t*5.28+a;
          float radius=0.09+pow(h,1.45)*1.05+pow(h,4.0)*0.65;
          #if TOON == 1
            radius+=.22*(1.0-smoothstep(.08,.55,h));
          #endif
          p=vec3(cos(spin)*radius,h*3.6-1.4,sin(spin)*radius);
          p.x+=sin(h*2.6+t*0.5)*h*0.35;
          size=0.025+seed.w*0.04;shape=vec2(4.0,0.45);vAlpha=sin(h*PI)*0.5;
          #if VARIANT == 0
            shape=vec2(7.0,0.23);size*=0.8;vAlpha*=0.65;
          #elif VARIANT == 1
            radius+=seed.z*0.4;p.xz=vec2(cos(spin),sin(spin))*radius;size=0.012+seed.w*0.035;shape=vec2(1.0,0.8);vAlpha*=0.75;
          #elif VARIANT == 2
            spin=a-t*2.4;float drift=pow(h,3.0)*(0.3+seed.z*0.8);p=vec3(cos(spin)*(radius+drift),h*3.8-1.4,sin(spin)*(radius+drift));size=0.016+seed.w*0.04;shape=vec2(0.8,2.7);vAlpha=sin(h*PI)*(0.45+0.45*sin(t*13.0+seed.z*19.0));
          #else
            h=floor(seed.y*6.0)/6.0+0.08;spin=a-t*2.4;radius=0.15+pow(h,1.2)*1.8;p=vec3(cos(spin)*radius,h*3.5-1.4+sin(spin*3.0)*0.07,sin(spin)*radius);size=0.018+seed.w*0.03;shape=vec2(1.0);vAlpha=0.25+pow(max(0.0,sin(seed.z*20.0+t*3.0)),4.0)*0.6;
          #endif
        #endif
      #endif
      #if KIND == 4 || KIND == 5
        vec3 field=curlFlow(vec3(p.x,p.y+1.4,p.z)*1.1,t);
        p+=field*(KIND==4?0.12:0.16)*smoothstep(0.0,0.25,p.y+1.4);
      #endif
      #if CLOUD == 1
        size*=uSize;
      #endif
      #if KIND == 4
        p.xz*=uSize;p.y=(p.y+1.4)*uSize-1.4;
      #endif
      vLife=clamp(vLife,0.0,1.0);
      vec4 mv=modelViewMatrix*vec4(p,1.0);
      float scale=length(modelMatrix[1].xyz);
      #if KIND == 0 && VARIANT == 2
        float spin=t*(1.0+seed.z*3.0)+a;vec3 shard=position*vec3(2.0,.55,.65)*size;
        shard.xy=mat2(cos(spin),-sin(spin),sin(spin),cos(spin))*shard.xy;
        mv=modelViewMatrix*vec4(p+shard,1.0);
      #elif TOON == 1 && KIND == 3 && VARIANT == 1 && CLOUD == 0
        vec3 direction=normalize(vec3(cos(a),.6+seed.y*1.8,sin(a)));
        vec2 along=normalize((modelViewMatrix*vec4(direction,0.0)).xy+vec2(.0001));
        mv.xy+=(along*position.x*shape.x+vec2(-along.y,along.x)*position.y*shape.y)*size*scale;
      #elif KIND == 4
        vec2 tangent=normalize((modelViewMatrix*vec4(-sin(spin),0.1,cos(spin),0.0)).xy);vec2 crossFlow=vec2(-tangent.y,tangent.x);
        mv.xy+=(tangent*position.x*shape.x+crossFlow*position.y*shape.y)*size*scale;
      #else
        mv.xy+=position.xy*size*shape*scale;
      #endif
      gl_Position=projectionMatrix*mv;
    }
  `;
  const particleFragment = `
    uniform vec3 uColor;uniform float uTime;
    varying vec2 vUv;varying float vAlpha;varying float vSeed;varying float vLife;varying float vLight;
    ${noise}${flow}${smokeLight}${flame}
    ${kind===0?projectileToon:""}
    varying vec3 vKeyLight;
    void main(){
      vec2 q=vUv*2.0-1.0;float d=length(q);
      #if !(KIND == 0 && VARIANT == 2)
        if(d>1.0)discard;
      #endif
      float alpha=exp(-d*d*5.0)*(1.0-smoothstep(0.65,1.0,d));
      vec3 color=mix(uColor,vec3(1.0),pow(1.0-d,8.0)*0.35);
      #if CLOUD == 1
        vec2 original=q;
        float angle=vSeed*6.28+uTime*0.18;
        mat2 rotation=mat2(cos(angle),-sin(angle),sin(angle),cos(angle));q=rotation*q;
        vec3 coarse=noiseGradient(q*2.8+vec2(vSeed*17.0,-uTime*0.18));
        #if TOON == 1
          vec3 fine=coarse;
        #else
          vec3 fine=noiseGradient(q*5.7+vec2(vSeed*31.0,-uTime*0.31));
        #endif
        float n=coarse.x*0.72+fine.x*0.28;
        vec2 gradient=mat2(cos(angle),sin(angle),-sin(angle),cos(angle))*(coarse.yz*2.8*0.72+fine.yz*5.7*0.28);
        float puff=1.0-smoothstep(0.43,1.0,d+(n-0.5)*0.43);
        float body=smoothstep(0.14,0.76,n+(1.0-d)*0.55);
        vec2 optics=smokeOptics(original,gradient,n,vKeyLight);
        float light=optics.x;
        color=uColor*light*1.15;
        alpha=puff*body*optics.y*1.35;
        #if KIND == 3
          float hot=vLight*(0.4+body*0.6);
          #if VARIANT == 0
            color=mix(uColor*(0.06+light*0.13),uColor*(1.8+hot*2.4)+vec3(pow(hot,3.0)*0.8),smoothstep(0.10,0.65,hot));
          #elif VARIANT == 1
            color=mix(uColor*0.35,uColor*1.7,hot);
          #elif VARIANT == 2
            color=uColor*(0.10+light*0.85);
          #else
            color=uColor*(0.18+light*0.95);
          #endif
        #else
          #if VARIANT == 2
            color=uColor*(0.40+light*0.65);
          #endif
        #endif
        #if TOON == 1
          color=styleColor(uColor,.20+light*.65+n*.18);
          alpha=(1.0-smoothstep(.68,.98,d+(n-.5)*.35))*smoothstep(.18,.42,n+(1.0-d)*.35)*.82;
          #if VARIANT == 0
            color=mix(styleColor(uColor*.28,light),styleHeat(uColor,hot*.65+n*.3),smoothstep(.10,.65,hot));
          #elif VARIANT == 1
            alpha*=.16;color=styleColor(uColor*.5,.2+light*.45);
          #endif
        #endif
      #elif KIND == 2
        #if VARIANT == 0
          float crossShape=min(max(abs(q.x)-0.20,abs(q.y)-0.66),max(abs(q.x)-0.66,abs(q.y)-0.20));
          alpha=1.0-smoothstep(-0.02,0.08,crossShape);color=uColor*1.2;
        #elif VARIANT == 1
          vec3 burn=flameErosion(vec2(vUv.x,vUv.y*1.3),uTime*1.8,vSeed*9.0);
          alpha=burn.x*pow(max(0.0,1.0-vUv.y),0.7)*smoothstep(0.0,0.2,vUv.y);color=flameColor(uColor,burn.y*0.7+(1.0-vUv.y)*0.3);
        #elif VARIANT == 2
          float a=atan(q.y,q.x);float spoke=pow(abs(cos(a*3.0)),28.0);
          alpha=(spoke*(1.0-smoothstep(0.4,0.85,d))+exp(-d*d*45.0))*0.85;
        #else
          alpha=band(max(abs(q.x),abs(q.y))-0.52,0.07);color=uColor*1.3;
        #endif
      #elif KIND == 0 && VARIANT == 3
        alpha=band(abs(q.x)+abs(q.y)-0.64,0.05)+exp(-d*d*35.0)*0.4;
      #elif KIND == 0 && VARIANT == 2
        alpha=0.8;color*=0.35+0.65*vUv.y;
      #elif (KIND == 3 && VARIANT == 3) || (KIND == 4 && VARIANT == 3)
        alpha=1.0-smoothstep(0.7,1.0,abs(q.x)+abs(q.y));
        color*=0.7+step(q.x,0.0)*0.5;
      #endif
      #if KIND == 0
        color=toonShade(uColor,.46+(1.0-d)*.4);
      #endif
      #if TOON == 1 && CLOUD == 0
        color=styleColor(uColor,.28+(1.0-d)*.5+vLight*.1);
        #if KIND == 3 && VARIANT == 1
          alpha=(1.0-smoothstep(.35,.75,abs(q.y)))*(1.0-smoothstep(.6,1.0,abs(q.x)));
        #elif KIND == 4 && VARIANT == 1
          color=styleColor(uColor*.55,.3+vSeed*.5);
        #elif (KIND == 3 && VARIANT == 0) || (KIND == 4 && VARIANT == 2)
          color=styleHeat(uColor,.50+(1.0-d)*.35);
        #endif
      #endif
      gl_FragColor=vec4(color,alpha*vAlpha*uDetail);
      ${output}
    }
  `;

  if(buildGrassEffect({THREE,kind,variant,instanced,shader,output})||buildUtilityEffect({THREE,spec,kind,variant,cap,group,uniforms,lifeUniforms,geometries,materials,allocations,animated,mesh,instanced,corePart,shader,noise,output})){}else if(variant>=4){throw new Error(`Unsupported effect variant in this build: ${kind}:${variant}`);}else{
  if(kind===5){
    instanced(new THREE.PlaneGeometry(1,1),cap,1,shader(particleFragment,particleVertex,{},false,{CLOUD:1}),0);
  }else{
    instanced(kind===0&&variant===2?new THREE.OctahedronGeometry(0.7):new THREE.PlaneGeometry(1,1),cap,kind===3?0.86:1,shader(particleFragment,particleVertex,{},true,{CLOUD:0}),3);
    if(kind===3)instanced(new THREE.PlaneGeometry(1,1),Math.min(variant===0?116:128,Math.ceil(cap*0.14)),0.14,shader(particleFragment,particleVertex,{},false,{CLOUD:1}),0);
  }
  if(kind===0){
    if(variant===0){
      // 一個連續、可變形的火焰體：不使用鏡頭朝向面片、球核或固定箭尖。
      // 尾端到燃燒前緣共用表面；尺寸權重只影響主燃燒區。
      const points=[],uvs=[],indices=[],rings=48,sides=20;
      for(let j=0;j<=rings;j++)for(let k=0;k<=sides;k++){
        const h=j/rings,a=k/sides*Math.PI*2,r=Math.pow(Math.sin(h*Math.PI),.6)*(.12+.5*h);
        points.push(-2.65+h*4.05,Math.cos(a)*r,Math.sin(a)*r);uvs.push(h,k/sides);
      }
      for(let j=0;j<rings;j++)for(let k=0;k<sides;k++){const n=j*(sides+1)+k;indices.push(n,n+1,n+sides+1,n+1,n+sides+2,n+sides+1);}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(points,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);
      const material=shader(`uniform float uTime;uniform vec3 uColor;varying vec2 vUv;varying vec3 vN;varying vec3 vView;${noise}${projectileToon}
        void main(){float h=vUv.x,a=vUv.y*PI*2.0,t=uTime;
          vec2 flowUV=vec2(h*8.0+t*2.7,cos(a)*1.6+sin(a)*2.1);
          float roll=noise2(flowUV),curl=noise2(flowUV*1.71+vec2(t*.9,3.7));
          // 只在前緣和尾端做大塊侵蝕，中央保持連續；不靠碎片堆出主體。
          float tear=roll*.68+curl*.32;
          float front=smoothstep(.78,1.0,h),back=1.0-smoothstep(.04,.40,h);
          if(tear<.16+front*.29+back*.34+sin(a*3.0+h*9.0+t*4.0)*back*.10)discard;
          vec3 n=normalize(vN),eye=normalize(vView);float roundness=abs(dot(n,eye));
          float turn=.5+.5*dot(n,normalize(vec3(-.3,.75,.6)));
          float heat=.10+roundness*.20+turn*.26+roll*.34+sin(h*10.0+a*2.0+t*6.0)*.10;
          vec3 c=mix(uColor*.38,uColor*1.12,toonStep(.40,heat));
          c=mix(c,mix(uColor,vec3(1.0,.88,.46),.6)*1.2,toonStep(.64,heat));
          gl_FragColor=vec4(c,1.0);${output}}`,`${noise}
        uniform float uTime;varying vec2 vUv;varying vec3 vN;varying vec3 vView;
        vec3 flamePoint(float h,float a){
          float t=uTime,body=smoothstep(.28,.68,h),scale=mix(1.0,uSize,body);
          float wave=sin(h*12.0+a*3.0+t*6.5),eddy=sin(h*8.0-a*2.0+t*4.1);
          float capAngle=clamp((h-.8)/.2,0.0,1.0)*PI*.5;
          float capFade=h>=1.0?0.0:cos(capAngle);
          float r=h>.8?pow(sin(.8*PI),.6)*.52*capFade:pow(max(.00001,sin(h*PI)),.6)*(.12+.5*h);
          r*=1.0+(wave*.28+eddy*.20)*mix(1.0,capFade,smoothstep(.78,.9,h));
          float spin=a+h*2.7+sin(h*6.0+t*3.2)*.30;
          float x=h>.8?.59+.52*sin(capAngle):-2.65+h*4.05;
          x+=(sin(a*3.0+t*5.5)*.07+eddy*.06)*smoothstep(.60,.82,h)*capFade*capFade;
          x+=sin(t*4.1)*.035*smoothstep(.78,1.0,h);
          x+=sin(a*3.0+h*8.0+t*5.0)*.35*(1.0-smoothstep(.05,.48,h));
          // 軸向接合比截面縮放更晚開始，避免最大尺寸把尾部折回自身。
          x+=(x-.65)*(uSize-1.0)*smoothstep(.55,.90,h);
          vec2 bend=vec2(sin(h*5.0+t*3.0),cos(h*7.0+t*2.7))*(.04+(.9-h)*.10);
          vec2 crossSection=vec2(cos(spin),sin(spin))*r+bend;
          return vec3(x,crossSection*scale);
        }
        void main(){vUv=uv;float h=clamp(uv.x,.001,1.0),a=uv.y*PI*2.0;vec3 p=flamePoint(h,a);
          float nh=min(h,.998);
          vec3 dh=flamePoint(min(nh+.001,1.0),a)-flamePoint(max(nh-.001,0.0),a);
          vec3 da=flamePoint(nh,a+.003)-flamePoint(nh,a-.003);
          vN=normalMatrix*normalize(cross(da,dh));vec4 mv=modelViewMatrix*vec4(p,1.0);vView=-mv.xyz;gl_Position=projectionMatrix*mv;}`,{},false);
      material.side=THREE.DoubleSide;material.transparent=false;material.depthWrite=true;
      const fire=mesh(g,material,2);fire.name='projectile-core';
    }else{
      // Other projectile variants (plasma, ice, arcane) are not included in this build.
      throw new Error(`Unsupported projectile variant in this build: ${kind}:${variant}`);
    }
  }else{
    throw new Error(`Unsupported effect kind in this build: ${kind}`);
  }
  }
  let impactMesh=null,impactGlow=null;
  function buildImpact(){
    if(kind!==0)return;
    const positions=[],centers=[],ids=[],indices=[],impactUvs=[];
    function patch(rows,cols,id,center,point){
      const base=positions.length/3;
      for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){
        const p=point(i/cols,j/rows);positions.push(...p);centers.push(...center);ids.push(id);impactUvs.push(i/cols,j/rows);
      }
      for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const a=base+j*(cols+1)+i,b=a+cols+1;indices.push(a,b,a+1,b,b+1,a+1);}
    }
    if(variant===0){
      // Twelve rolling volume impostors reuse the ember budget during impact only.
      for(let i=0;i<12;i++)patch(1,1,i,[0,0,0],(u,v)=>[u-.5,v-.5,0]);
    }else{
      return;
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(impactUvs,2));geo.setAttribute('aCenter',new THREE.Float32BufferAttribute(centers,3));geo.setAttribute('aPart',new THREE.Float32BufferAttribute(ids,1));geo.setIndex(indices);geo.computeVertexNormals();
    const vertex=`attribute vec3 aCenter;attribute float aPart;uniform float uLifeEnd,uLifeOrigin;varying vec3 vP;varying vec3 vImpactNormal;varying vec2 vFlow;varying float vPart;
      #if VARIANT == 0
      uniform vec3 uImpactUp;
      #endif
      void main(){vFlow=uv;vImpactNormal=normal;float t=uLifeEnd;float open=1.0-exp(-t*7.0);vec3 p=position;vPart=aPart;
        #if VARIANT == 0
          float seed=fract(sin(aPart*17.13+2.8)*4375.3),level=fract(aPart*.381966),age=max(0.0,t-aPart*.006);
          float grow=1.0-exp(-age*12.0),spin=aPart*2.399963+age*(1.7+seed);
          vec3 up=normalize(uImpactUp),depth=vec3(1,0,0)-up*up.x;
          if(dot(depth,depth)<.01)depth=vec3(0,0,1)-up*up.z;
          depth=normalize(depth);vec3 across=cross(depth,up);
          // Spherical emission from the contact point; buoyancy follows the radial impulse.
          float vertical=1.0-2.0*(aPart+.5)/12.0;
          float ring=sqrt(max(0.0,1.0-vertical*vertical));
          vec3 direction=up*vertical+depth*cos(spin)*ring+across*sin(spin)*ring;
          float radial=grow*(.67+seed*.26)+age*.12;
          vec3 center=direction*radial+up*smoothstep(.30,.95,age)*.32;
          center*=uSize*(.35+.65*uLifeOrigin);
          vec4 mv=modelViewMatrix*vec4(center,1.0);
          float width=(.20+grow*.95)*(.85+seed*.25)*(1.0-smoothstep(.65,1.0,age)*.22);
          mv.xy+=(uv-.5)*vec2(width,width*(1.05+level*.2))*uSize*(.35+.65*uLifeOrigin)*length(modelMatrix[1].xyz);
          vImpactNormal=normalize(mat3(viewMatrix)*vec3(-.45,.8,.55));vP=center;gl_Position=projectionMatrix*mv;return;
        #endif
        p*=uSize*(.35+.65*uLifeOrigin);vP=p;
gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.0);
      }`;
    const fragment=`uniform vec3 uColor;uniform float uLifeEnd;varying vec3 vP;varying vec3 vImpactNormal;varying vec2 vFlow;varying float vPart;${noise}${flow}${smokeLight}${projectileToon}
      void main(){float t=uLifeEnd;float fade=smoothstep(.0,.07,t)*(1.0-smoothstep(.52,1.0,t));
        vec3 n=normalize(cross(dFdx(vP),dFdy(vP)));

        float light=.35+abs(dot(n,normalize(vec3(.7,1,.5))))*.45;float mask=1.0;
        #if VARIANT == 0
          vec2 q=vFlow*2.0-1.0;float age=max(0.0,t-vPart*.006),seed=fract(vPart*.618034);
          float turn=age*(1.7+seed)+vPart*2.4;
          q=mat2(cos(turn),-sin(turn),sin(turn),cos(turn))*q;
          vec3 density=noiseGradient(q*3.2+vec2(seed*17.0,-age*2.3));
          float fine=noise2(q*7.0+density.x*1.4+seed*13.0);
          float n0=density.x*.76+fine*.24,d=length(q)+(n0-.5)*.35;
          vec2 optics=smokeOptics(q,density.yz*3.2,n0,vImpactNormal);
          float burnout=smoothstep(.40+seed*.12,.96,age);
          mask=(1.0-smoothstep(.79,.94,d))*smoothstep(.18+burnout*.55,.40+burnout*.5,n0+(1.0-d)*.50);
          light=.20+n0*.55+(1.0-d)*.15+optics.x*.16-age*.13;
          fade=smoothstep(.0,.055,age)*(1.0-smoothstep(.65+seed*.08,.97,age))*.82;
        #endif
        if(mask*fade<.006)discard;
        vec3 c=toonShade(uColor,light);
        #if VARIANT == 0
          c=mix(uColor*vec3(.50,.18,.07),uColor*1.08,toonStep(.46,light));c=mix(c,vec3(1.0,.92,.58),toonStep(.68,light));
        #endif
        gl_FragColor=vec4(c,mask*fade);${output}
      }`;
    impactMesh=mesh(geo,shader(fragment,vertex,{uImpactUp:{value:new THREE.Vector3(0,1,0)}},false),5);if(variant===0){impactMesh.material.depthWrite=false;}impactMesh.name='lifecycle-impact';impactMesh.visible=false;
    impactGlow=mesh(new THREE.PlaneGeometry(1.8,1.8),shader(`uniform vec3 uColor;uniform float uLifeEnd;varying vec2 vUv;
      void main(){vec2 q=vUv*2.0-1.0;float t=uLifeEnd;float a=exp(-dot(q,q)*5.5)*(1.0-smoothstep(.0,.28,t))*smoothstep(.0,.025,t)*.24;
        gl_FragColor=vec4(uColor,a);${output}}`, `uniform float uLifeEnd;varying vec2 vUv;
      void main(){vUv=uv;vec4 mv=modelViewMatrix*vec4(0,0,0,1);mv.xy+=position.xy*uSize*(.5+uLifeEnd*2.0);gl_Position=projectionMatrix*mv;}`),4);
    impactGlow.name='lifecycle-contact-glow';impactGlow.visible=false;
  }
  installLifecycle();buildImpact();

  function setOptions(next={}){
    if(disposed)return;
    settings={...settings,...next};
    if(spec.quantity) {
      const q=spec.quantity;
      settings.quantity=Number.isFinite(settings.quantity)?THREE.MathUtils.clamp(Math.round(settings.quantity),q.min,q.max):q.default;
    } else delete settings.quantity;
    uniforms.uQuantity.value=settings.quantity??quantityDefault;
    if(spec.spread) {
      const spread=spec.spread;
      settings.spread=Number.isFinite(settings.spread)?THREE.MathUtils.clamp(settings.spread,spread.min,spread.max):spread.default;
    } else delete settings.spread;
    uniforms.uSpread.value=settings.spread??1;
    settings.size=THREE.MathUtils.clamp(Number(settings.size)||1,0.25,2);
    settings.density=THREE.MathUtils.clamp(Number(settings.density)||0.125,0.125,1);
    if(!/^#[0-9a-f]{6}$/i.test(settings.color))settings.color=spec.color;
    uniforms.uColor.value.set(settings.color);
    const desired=Math.max(1,Math.round(cap*settings.density));
    const fixedBillows=kind===3&&variant===2?7:kind===3&&(variant===4||variant===6)?12:kind===4&&toon&&variant===1?22:0;
    let remaining=desired-fixedBillows;count=fixedBillows;
    for(let i=allocations.length-1;i>=0;i--){
      const item=allocations[i];
      const n=i===0?remaining:Math.min(item.maximum,Math.round(desired*item.weight));
      item.geometry.instanceCount=n;remaining-=n;count+=n;
    }
    settings.speed=THREE.MathUtils.clamp(Number(settings.speed)||1,0.25,2);
    settings.detail=THREE.MathUtils.clamp(Number(settings.detail)||0.25,0.25,2);
    uniforms.uSize.value=settings.size;uniforms.uDetail.value=settings.detail;
    for(const item of coreParts){
      item.object.scale.copy(item.scale);
      for(const axis of item.axes)item.object.scale[axis]*=settings.size;
      item.object.position.copy(item.position);
      if(item.pivot)item.object.position.y+=item.pivot*(1-settings.size);
    }
    if(endpoints)applyEndpoints();
    syncLifecycle();
  }
  function applyEndpoints(){
    scratch.subVectors(endpoints.end,endpoints.start);const length=scratch.length();
    group.position.copy(endpoints.start).add(endpoints.end).multiplyScalar(0.5);
    if(length>0)group.quaternion.setFromUnitVectors(axis,scratch.normalize());
    group.scale.set(length/4.8,1,1);
    uniforms.uStretch.value=Math.max(0.001,length/4.8);
    group.visible=length>0;
  }
  function syncLifecycle(){
    if(spec.burst){
      phase=time+1e-9>=spec.duration?'finished':time+1e-9>=spec.duration*.55?'ending':time+1e-9>=spec.duration*.1?'active':'starting';
    }else if(stopTime>=0){phase=endTime+1e-9>=lifecycle.end?'finished':'ending';}
    else phase=time+1e-9>=lifecycle.start?'active':'starting';
    const start=stopTime>=0?endStart:Math.min(1,time/lifecycle.start);
    lifeUniforms.uEmitterTime.value=stopTime>=0?stopTime:time;
    lifeUniforms.uLifeStart.value=start;lifeUniforms.uLifeEnd.value=spec.burst?Math.max(0,Math.min(1,(time/spec.duration-.55)/.45)):stopTime>=0?Math.min(1,endTime/lifecycle.end):0;
    lifeUniforms.uLifeStage.value=phase==='active'?1:phase==='starting'?0:2;
    lifeUniforms.uLifeOrigin.value=endStart;lifeUniforms.uStopTime.value=stopTime;lifeUniforms.uImpact.value=impact?1:0;
    for(const m of stageOpaque){m.transparent=phase!=='active';m.depthWrite=phase==='active';}
    for(const p of stagePlanes)p.geometry.setDrawRange(phase==='active'?0:p.steady,phase==='active'?p.steady:p.transition);
    group.visible=phase!=='finished'&&(!endpoints||endpoints.start.distanceToSquared(endpoints.end)>0);
    if(impactMesh){impactMesh.visible=impact&&phase==='ending';impactGlow.visible=impact&&phase==='ending'&&endTime/lifecycle.end<.28;}
    // Reserve 12 of the existing fire ember slots for the merged impact billows.
    if(kind===0&&variant===0&&allocations.length===1)allocations[0].geometry.instanceCount=Math.max(0,count-(impact&&phase==='ending'?12:0));
  }
  function stop(){
    if(disposed||phase==='ending'||phase==='finished'||spec.burst)return;
    endStart=Math.min(1,time/lifecycle.start);stopTime=time;endTime=0;syncLifecycle();
  }
  const hitPoint=new THREE.Vector3(),hitNormal=new THREE.Vector3(),worldToHit=new THREE.Matrix4();
  // Default contact is the animated leading surface, not the group origin.
  // Evaluated only on hit: no per-frame geometry walk or particle updates.
  function projectileContact(out){
    const size=settings.size;
    if(variant===0){
      out.set(.65+(.46+Math.sin(time*4.1)*.035)*size,Math.sin(5+time*3)*.03*size,Math.cos(7+time*2.7)*.03*size);
    }else out.set(size,0,0);
    if(time<lifecycle.start){
      const start=time/lifecycle.start,grow=start*start*(3-2*start),curl=1-grow;
      if(variant===0){out.y*=.22+.78*grow;out.z*=.22+.78*grow;out.x=(out.x*.38-.16)*(1-grow)+out.x*grow;out.y+=Math.sin(out.x*4.5+start*7)*curl*.15;}
    }
    return out;
  }
  function hit(position,normal){
    if(kind!==0||disposed||phase==='ending'||phase==='finished')return;
    if(position&&(!Number.isFinite(position.x)||!Number.isFinite(position.y)||!Number.isFinite(position.z)))return;
    projectileContact(impactMesh.position);
    if(position){
      hitPoint.copy(position);if(group.parent){group.parent.updateWorldMatrix(true,false);group.parent.worldToLocal(hitPoint);}
      scratch.copy(impactMesh.position).multiply(group.scale).applyQuaternion(group.quaternion);
      group.position.copy(hitPoint).sub(scratch);
    }
    impactGlow.position.copy(impactMesh.position);
    group.updateWorldMatrix(true,false);worldToHit.copy(group.matrixWorld).invert();
    if(normal)hitNormal.copy(normal);else hitNormal.copy(axis).transformDirection(group.matrixWorld).negate();
    if(!Number.isFinite(hitNormal.lengthSq())||hitNormal.lengthSq()<1e-10)hitNormal.copy(axis).transformDirection(group.matrixWorld).negate();
    hitNormal.transformDirection(worldToHit);
    impactMesh.quaternion.setFromUnitVectors(axis,hitNormal);
    if(variant===0){impactMesh.updateWorldMatrix(true,false);worldToHit.copy(impactMesh.matrixWorld).invert();impactMesh.material.uniforms.uImpactUp.value.set(0,1,0).transformDirection(worldToHit);}
    impact=true;stop();
  }
  function update(dt){
    if(disposed||!Number.isFinite(dt)||dt<0||phase==='finished')return;
    const visual=dt*settings.speed;time+=visual;uniforms.uTime.value=time;
    if(stopTime>=0)endTime+=visual;
    if(kind===0&&travelSpeed&&stopTime<0)group.position.addScaledVector(direction,dt*travelSpeed);
    for(const animate of animated)animate();syncLifecycle();
  }
  function reset(){
    if(disposed)return;time=0;endTime=0;stopTime=-1;impact=false;endStart=1;phase='starting';
    uniforms.uTime.value=0;if(impactMesh){impactMesh.position.set(0,0,0);impactGlow.position.set(0,0,0);}syncLifecycle();update(0);
  }
  function dispose(){
    if(disposed)return;disposed=true;phase='finished';group.visible=false;group.removeFromParent();
    for(const geometry of geometries)geometry.dispose();
    for(const material of materials)material.dispose();
    geometries.clear();materials.clear();group.clear();
  }
  setOptions(settings);update(0);
  return {
    group,update,setOptions,reset,dispose,stop,hit,
    get settings(){return {...settings};},get particleCount(){return count;},
    get elapsed(){return time;},get phase(){return phase;},get finished(){return phase==='finished';},
    get lifecycle(){return {...lifecycle};},
    setDirection(vector,speed=4){
      if(kind!==0||disposed||phase==='ending'||phase==='finished'||!vector||!Number.isFinite(vector.lengthSq())||vector.lengthSq()===0)return;
      direction.copy(vector).normalize();travelSpeed=Math.max(0,Number(speed)||0);
      group.quaternion.setFromUnitVectors(axis,direction);
    },
    setEndpoints(start,end){
      if(kind!==1||disposed||phase==='ending'||phase==='finished')return;
      endpoints={start:start.clone(),end:end.clone()};applyEndpoints();
    },
  };
}

// The original module also ships utility effects and painterly grass; the fireball never
// reaches them, so they are left out of this build.
function buildUtilityEffect() {
  return false;
}
function buildGrassEffect() {
  return false;
}

const preset = {
  "id": "fireball",
  "lifecycle": {
    "start": 0.35,
    "end": 0.8
  },
  "name": "火球",
  "english": "Fireball",
  "category": "projectile",
  "color": "#ff823e",
  "description": "連續的立體火焰向後翻捲、拉伸與撕裂，燃燒前緣持續變形；三段卡通色階保留整體感與明暗層次。",
  "tags": "火焰 法師 技能 飛行",
  "maxParticles": 768,
  "kind": 0,
  "variant": 0,
  "duration": 5,
  "burst": false,
  "seed": 9187,
  "schools": [
    "fire"
  ]
};
export const defaultOptions = {
  "speed": 1,
  "detail": 1,
  "color": "#ff823e",
  "size": 1,
  "density": 0.5
};
export default function createVFX(options = {}) {
  return createEffect(preset, { ...defaultOptions, ...options });
}
