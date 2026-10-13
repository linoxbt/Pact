#!/usr/bin/env python3
"""Join checked Hyperframes scenes and mix licensed Brag music and CC0 UI cues."""
from pathlib import Path
import subprocess

here=Path(__file__).resolve().parent
out=here.parents[1]/'Pact-Intro-24s.mp4'
poster=here.parents[1]/'Pact-Intro-Poster.jpg'
lst=here/'chapters.txt'
lst.write_text(''.join(f"file '{here/'chapters'/f'{i:02d}'/'chapter.mp4'}'\n" for i in range(1,5)))

def run(*args):
    subprocess.run(args,check=True)

raw=here/'intro-raw.mp4'
run('ffmpeg','-y','-f','concat','-safe','0','-i',str(lst),'-stream_loop','-1','-i',str(here/'music.mp3'),
    '-i',str(here/'click.ogg'),'-i',str(here/'switch.ogg'),'-filter_complex',
    '[1:a]volume=0.19,atrim=0:24,afade=t=in:st=0:d=0.8,afade=t=out:st=21.5:d=2.5[m];'
    '[2:a]volume=0.3,adelay=7600|7600[c];[3:a]volume=0.25,adelay=14600|14600[s];'
    '[m][c][s]amix=inputs=3:duration=first:normalize=0[a]',
    '-map','0:v','-map','[a]','-t','24','-c:v','copy','-c:a','aac','-b:a','160k','-movflags','+faststart',str(raw))
run('ffmpeg','-y','-ss','3.2','-i',str(raw),'-frames:v','1','-q:v','2',str(poster))
run('ffmpeg','-y','-i',str(raw),'-i',str(poster),'-filter_complex',
    "[0:v][1:v]overlay=0:0:enable='eq(n,0)'[v]",'-map','[v]','-map','0:a?',
    '-c:v','libx264','-crf','19','-preset','medium','-pix_fmt','yuv420p','-c:a','copy',
    '-movflags','+faststart',str(out))
raw.unlink()
print(out)
