import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {chartTheme} from '../src/presentation/chartTheme.js';

const css=readFileSync(new URL('../src/presentation/tech-ui.css',import.meta.url),'utf8');
const tokens=Object.fromEntries([...css.match(/^:root\{([^}]+)\}/m)[1].matchAll(/--([\w-]+):([^;]+)/g)].map(match=>[match[1],match[2]]));
const authoring=readFileSync(new URL('../../../structured-output-service/frontend/main.jsx',import.meta.url),'utf8');
const luminance=hex=>{const channels=[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;};
const contrast=(a,b)=>{const [light,dark]=[luminance(a),luminance(b)].sort((x,y)=>y-x);return(light+.05)/(dark+.05);};

test('the global reading palette follows the 3001 authoring tokens',()=>{
  for(const [token,source]of Object.entries({'bg-base':'colorBgBase',surface:'colorBgContainer','surface-raised':'colorBgElevated','text-primary':'colorText',muted:'colorTextSecondary',accent:'colorPrimary',success:'colorSuccess',error:'colorError',border:'colorBorder'})){
    assert.equal(tokens[token],authoring.match(new RegExp(source+": '(#[a-f0-9]{6})'"))[1],source);
  }
});
test('text, primary buttons and input boundaries remain readable on light surfaces',()=>{
  for(const surface of ['bg-base','surface','surface-raised','surface-input']){
    assert(contrast(tokens['text-primary'],tokens[surface])>=4.5,surface+' text');
    assert(contrast(tokens.muted,tokens[surface])>=4.5,surface+' secondary text');
  }
  assert(contrast(tokens.surface,tokens.accent)>=4.5);
  assert(contrast(tokens.surface,tokens['accent-hover'])>=4.5);
  assert(contrast(tokens['control-border'],tokens['surface-input'])>=3);
  assert(contrast(chartTheme.textStyle.color,tokens.surface)>=4.5);
  assert(contrast(chartTheme.tooltip.textStyle.color,chartTheme.tooltip.backgroundColor)>=4.5);
});
test('loading, success and error assets retain animated keyframes and valid timelines',()=>{
  for(const name of ['loading','success','error']){
    const asset=JSON.parse(readFileSync(new URL('../src/presentation/assets/'+name+'.json',import.meta.url),'utf8'));
    assert(asset.fr>0&&asset.op>asset.ip&&asset.w>0&&asset.h>0);
    let animated=false;
    const walk=value=>{if(value&&typeof value==='object'){if(value.a===1&&Array.isArray(value.k)&&value.k.some(frame=>typeof frame.t==='number'))animated=true;Object.values(value).forEach(walk);}};
    walk(asset);assert(animated,name+' must contain animated keyframes');
  }
});
