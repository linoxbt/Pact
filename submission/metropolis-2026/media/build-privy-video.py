#!/usr/bin/env python3
"""Render a clearly labeled Pact/Privy product-flow explainer (not a live auth recording)."""
from pathlib import Path
from html import escape
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'Pact-Privy-Integration-1m12.mp4'
WORK = Path('/tmp/pact-privy-video')
WORK.mkdir(parents=True, exist_ok=True)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
MUSIC = Path('/root/.codex/skills/brag/assets/music/happy-beats-business-moves-vol-10-by-ende-dot-app.mp3')
SCENES = [
  ('01 / IDENTITY', 'One account. Your own wallet.', ['Email, passkey or wallet sign-in', 'Privy creates a wallet for each user', 'Pact maps the verified Privy DID to an owner'], 'Privy auth + embedded wallet'),
  ('02 / PASSKEY', 'Access that stays yours.', ['Create or link a passkey in Account', 'Return without connecting a wallet extension', 'Passkey protects account access'], 'Privy passkey linking'),
  ('03 / OWNERSHIP', 'Prove control before signing.', ['Pact issues a short-lived address challenge', 'Your Privy wallet signs the exact message', 'Pact verifies the signature before enabling Monad'], 'No shared signing key'),
  ('04 / ACTION', 'Review the transaction.', ['See action, payer, chain and treasury', 'Your wallet authorizes 5 testnet MON', 'Pact verifies confirmation before creation'], 'Monad testnet action fee'),
  ('05 / RECOVERY', 'Resume safely.', ['Submitted hash is retained for verification', 'A refresh does not silently pay again', 'Payment history resumes unfinished actions'], 'Explicit transaction confirmation'),
  ('06 / AGENT', 'Keep agent authority separate.', ['Scoped agent keys call the Pact gateway', 'Grants and policies bound each action', 'The agent never receives your signing wallet'], 'Privy identity + Pact enforcement'),
]

def run(*args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL)

def text(x, y, value, size, color='#203d32', weight='bold'):
    return f'<text x="{x}" y="{y}" fill="{color}" font-family="DejaVu Sans" font-size="{size}" font-weight="{weight}">{escape(value)}</text>'

for i, (eyebrow, title, bullets, tag) in enumerate(SCENES, 1):
    sv = ['<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">',
          '<rect width="1280" height="720" fill="#f8f8f3"/>',
          '<rect x="0" y="0" width="28" height="720" fill="#203d32"/>',
          '<circle cx="1120" cy="-10" r="275" fill="none" stroke="#c3dfc6" stroke-width="55"/>',
          '<rect x="76" y="414" width="1115" height="225" rx="22" fill="#203d32"/>',
          text(77, 73, 'pact', 46), text(77, 132, eyebrow, 21, '#4b8660'),
          text(77, 240, title, 52),
          '<rect x="77" y="291" width="390" height="56" rx="28" fill="#d9ead9"/>',
          text(99, 327, tag, 19),
          text(112, 469, '01', 17, '#b6deb9'), text(160, 469, bullets[0], 25, '#ffffff'),
          text(112, 537, '02', 17, '#b6deb9'), text(160, 537, bullets[1], 25, '#ffffff'),
          text(112, 605, '03', 17, '#b6deb9'), text(160, 605, bullets[2], 25, '#ffffff'),
          text(78, 687, 'PRODUCT FLOW EXPLAINER  •  IMPLEMENTED CODE PATHS  •  NOT A LIVE TRANSACTION RECORDING', 13, '#54745d'),
          text(1137, 687, f'{i:02d} / 06', 15, '#54745d'), '</svg>']
    svg = WORK / f'{i:02d}.svg'
    svg.write_text(''.join(sv))
    run('convert', '-background', 'none', str(svg), str(WORK / f'{i:02d}.png'))
    run('ffmpeg', '-y', '-loop', '1', '-framerate', '30', '-i', str(WORK / f'{i:02d}.png'),
        '-vf', 'scale=1344:756,crop=1280:720:x=32+16*sin(n/45):y=18+10*cos(n/60),format=yuv420p',
        '-t', '12', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', '30',
        str(WORK / f'{i:02d}.mp4'))

concat = WORK / 'concat.txt'
concat.write_text(''.join(f"file '{WORK / f'{i:02d}.mp4'}'\n" for i in range(1, 7)))
run('ffmpeg', '-y', '-f', 'concat', '-safe', '0', '-i', str(concat), '-stream_loop', '-1', '-i', str(MUSIC),
    '-filter_complex', '[1:a]volume=0.19,afade=t=in:st=0:d=1.4,afade=t=out:st=68:d=4[a]',
    '-map', '0:v', '-map', '[a]', '-t', '72', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', str(OUT))
print(OUT)
