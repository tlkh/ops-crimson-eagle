import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
// Set PLAYWRIGHT_MODULE to an existing Playwright package, or install playwright locally.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const preview = process.argv.includes('--preview');
const formats = process.argv.includes('--portrait') ? [[1080,1920,'9x16']] : process.argv.includes('--landscape') ? [[1920,1080,'16x9']] : [[1920,1080,'16x9'],[1080,1920,'9x16']];
const dest='output/trailers'; const captureUrl=process.env.TRAILER_URL??'http://127.0.0.1:5173/ops-crimson-eagle/scripts/trailer/index.html'; await mkdir(dest,{recursive:true});
const browser=await chromium.launch({headless:true,channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
try{
 for(const [width,height,name] of formats){
  const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
  page.on('pageerror',e=>console.error('PAGE ERROR',e));
  page.on('console',m=>{if(m.type()==='error')console.error('BROWSER',m.text());});
  await page.goto(captureUrl);
  await page.waitForFunction(()=>!!window.trailer,{timeout:120000});
  const metadata=await page.evaluate(()=>window.trailer.metadata);
  console.log(JSON.stringify(metadata));
  await writeFile(`${dest}/${name}-edit.json`,JSON.stringify(metadata,null,2));
  if(preview){
   for(const n of [65,185,305,415,545,665,785,935,1045,1175,1300]){
    const b64=await page.evaluate(n=>window.trailer.frame(n,false),n);
    await writeFile(`${dest}/${name}-preview-${n}.png`,Buffer.from(b64,'base64'));
   }
  }else{
   const encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',`${dest}/${name}-picture.mp4`],{stdio:['pipe','inherit','inherit']});
   let encoderError;encoder.on('error',e=>{encoderError=e;});encoder.stdin.on('error',e=>{encoderError=e;});
   for(let n=0;n<1350;n++){
    if(encoderError)throw encoderError;
    const b64=await page.evaluate(n=>window.trailer.frame(n),n);
    if(!encoder.stdin.write(Buffer.from(b64,'base64')))await once(encoder.stdin,'drain');
    if(n%90===0)console.log(`${name}: ${n}/1350 frames`);
   }
   encoder.stdin.end();const [code]=await once(encoder,'exit');if(code!==0)throw Error(`ffmpeg ${code}`);
   const wav=await page.evaluate(()=>window.trailer.audio());
   await writeFile(`${dest}/${name}-game-audio.wav`,Buffer.from(wav,'base64'));
   const poster=await page.evaluate(()=>window.trailer.frame(65,false));
   await writeFile(`${dest}/ops-crimson-eagle-${name}-poster.png`,Buffer.from(poster,'base64'));
   console.log(`${name}: picture, sound and poster complete`);
  }
  await page.close();
 }
}finally{await browser.close();}
