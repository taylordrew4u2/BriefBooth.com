"""Render the README's dated screenshot walkthrough locally (no hosted video service).
Run: python -m pip install imageio-ffmpeg; python scripts/render-walkthrough.py
"""
from pathlib import Path
import subprocess
import tempfile
import imageio_ffmpeg

ROOT = Path(__file__).resolve().parents[1]
MEDIA = ROOT / 'docs/media'
SCENES = [
    ('home-desktop-2026-10-24.png', 'BriefBooth | Desktop + phone tour', 'Current public app, October 24, 2026. Edited screenshot walkthrough.', 6),
    ('project-types-desktop.png', 'Choose every project type that fits', '4u Digital intake: Software, Website and Mobile application selected.', 7),
    ('intake-current.png', 'One question at a time', 'Demo: describe the idea, go back, or skip optional questions.', 6),
    ('consultations-current.png', 'Choose a consultation', 'The demo shows service descriptions and durations before scheduling.', 6),
    ('scheduling-current.png', 'Find a time on desktop', 'Select a meeting format, date, timezone and available appointment.', 6),
    ('home-mobile-2026-10-24.png', 'The same app on a phone', 'Responsive public homepage at a 390-pixel phone viewport.', 5),
    ('project-types-mobile.png', 'Project choices on a phone', 'Large checkbox controls support more than one selection. Scroll for more.', 6),
    ('scheduling-mobile-current.png', 'Schedule on a phone', 'The booking flow adapts to a narrow screen without a separate app.', 6),
    ('confirmation-mobile-current.png', 'Demo complete', 'Fictional client data. No real booking, email, meeting or charge created.', 6),
]

def render():
    ff = imageio_ffmpeg.get_ffmpeg_exe()
    font_candidates = [Path('/System/Library/Fonts/Supplemental/Arial.ttf'), Path('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf')]
    font = next((p for p in font_candidates if p.exists()), None)
    if font is None:
        raise RuntimeError('Install Arial or DejaVu Sans before rendering captions.')
    with tempfile.TemporaryDirectory(prefix='briefbooth-walkthrough-') as temp:
        temp = Path(temp)
        for i, (filename, title, subtitle, seconds) in enumerate(SCENES):
            (temp / f'title{i}.txt').write_text(title)
            (temp / f'subtitle{i}.txt').write_text(subtitle)
            vf = (
                'scale=1280:610:force_original_aspect_ratio=decrease,'
                'pad=1280:720:(ow-iw)/2:0:color=0xeaf3ff,setsar=1,'
                'drawbox=x=0:y=610:w=1280:h=110:color=0x17365b:t=fill,'
                f'drawtext=fontfile={font}:textfile={temp}/title{i}.txt:fontcolor=white:fontsize=28:x=30:y=630,'
                f'drawtext=fontfile={font}:textfile={temp}/subtitle{i}.txt:fontcolor=white:fontsize=20:x=30:y=675'
            )
            subprocess.run([ff, '-v', 'error', '-y', '-loop', '1', '-i', str(MEDIA / filename), '-vf', vf, '-t', str(seconds), '-r', '24', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', str(temp / f'scene{i}.mp4')], check=True)
        listing = temp / 'concat.txt'
        listing.write_text(''.join(f"file '{temp}/scene{i}.mp4'\n" for i in range(len(SCENES))))
        output = MEDIA / 'briefbooth-walkthrough.mp4'
        subprocess.run([ff, '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', str(listing), '-c', 'copy', '-movflags', '+faststart', str(output)], check=True)
        # Decode the entire result: malformed/truncated videos must fail the build.
        subprocess.run([ff, '-v', 'error', '-xerror', '-i', str(output), '-f', 'null', '-'], check=True)
        print(f'Rendered and decoded {sum(s[3] for s in SCENES)} seconds: {output}')

if __name__ == '__main__':
    render()
