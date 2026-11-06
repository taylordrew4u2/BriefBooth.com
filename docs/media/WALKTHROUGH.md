# BriefBooth desktop and phone walkthrough

Captured October 24, 2026 from the current public app at briefbooth.com. The 54-second video is silent with burned-in captions. It is an edited sequence of browser screenshots, not a continuous screen recording.

| Time | View | Caption / purpose |
| --- | --- | --- |
| 00:00–00:06 | Desktop homepage | BriefBooth: current desktop and phone tour. |
| 00:06–00:13 | Desktop project intake | Select Software, Website and Mobile application together. |
| 00:13–00:19 | Desktop demo question | One question at a time, with back and optional skip controls. |
| 00:19–00:25 | Desktop consultation selection | Compare service descriptions and durations. |
| 00:25–00:31 | Desktop scheduling | Select format, day, timezone and an available appointment. |
| 00:31–00:36 | Phone homepage | Responsive layout at 390 × 844. |
| 00:36–00:42 | Phone project intake | Large multi-select controls; scroll for remaining choices. |
| 00:42–00:48 | Phone scheduling | The same booking flow on a narrow screen. |
| 00:48–00:54 | Phone demo completion | No real booking, email, meeting or charge created. |

The 4u Digital intake capture uses Alex Example / alex@example.com and stops before submission. The completed demo uses fictional Alex Morgan and Jordan Example / jordan@example.com. No authenticated account data, private management links, credentials, or OAuth screens appear in the video. Public provider controls in the demo do not imply Google or Zoom public-review approval.

## Playback and reproduction

[Watch or download the MP4](briefbooth-walkthrough.mp4). GitHub may provide a download link rather than an inline player. The file is H.264, 1280 × 720, 24 fps, with browser-compatible YUV420p and fast-start metadata. No audio track is required; captions and this transcript contain the explanation.

Render locally from the committed screenshots:

```sh
python3 -m venv /tmp/briefbooth-video-tools
/tmp/briefbooth-video-tools/bin/pip install imageio-ffmpeg
/tmp/briefbooth-video-tools/bin/python scripts/render-walkthrough.py
```

The renderer uses free local software, requires Arial on macOS or DejaVu Sans on Linux, and fully decodes the output to detect encoding errors. No YouTube, paid service, or account is needed. Documentation media stays outside the deployed website bundle.

The older October 19 studio images remain in the README as explicitly dated supplemental captures; they are not used in this updated video.
