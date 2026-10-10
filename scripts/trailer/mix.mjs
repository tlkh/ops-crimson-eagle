import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const directory='output/trailers';
for(const format of ['16x9','9x16']){
 const args=['-hide_banner','-loglevel','error','-y','-i',`${directory}/${format}-picture.mp4`,'-i',`${directory}/${format}-game-audio.wav`,'-stream_loop','-1','-i','public/music/sg-02.mp3','-filter_complex',
 '[1:a]asplit=2[game][key];[key]highpass=f=650[keyvoice];[2:a]atrim=0:45,asetpts=PTS-STARTPTS,volume=0.65,afade=t=in:d=1.3,afade=t=out:st=42:d=3[music];[music][keyvoice]sidechaincompress=threshold=0.012:ratio=6:attack=12:release=420[ducked];[game][ducked]amix=inputs=2:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000[a]',
 '-map','0:v','-map','[a]','-c:v','libx264','-preset','slow','-crf','18','-vf','scale=in_range=auto:out_range=tv:out_color_matrix=bt709,format=yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-c:a','aac','-b:a','192k','-t','45','-movflags','+faststart',`${directory}/ops-crimson-eagle-${format}.mp4`];
 const result=spawnSync('ffmpeg',args,{stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);
 const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',`${directory}/ops-crimson-eagle-${format}.mp4`],{encoding:'utf8'});
 if(probe.status!==0)throw Error(probe.stderr);
 const data=JSON.parse(probe.stdout);const v=data.streams.find(s=>s.codec_type==='video'),a=data.streams.find(s=>s.codec_type==='audio');
 const size=format==='16x9'?[1920,1080]:[1080,1920];
 if(v.width!==size[0]||v.height!==size[1]||v.r_frame_rate!=='30/1'||v.codec_name!=='h264'||v.pix_fmt!=='yuv420p'||a.codec_name!=='aac'||Math.abs(Number(data.format.duration)-45)>.05)throw Error('Output format validation failed');
 await writeFile(`${directory}/${format}-probe.json`,JSON.stringify(data,null,2));
 console.log(`${format}: verified ${v.width}×${v.height}, 30fps, ${data.format.duration}s, H.264/AAC`);
}
