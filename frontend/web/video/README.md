# Onboarding video

`video.html` is the animated walkthrough. It uses the site's own `web/main.css`, so it matches the page.
`record.mjs` steps it frame by frame in headless Chrome. Then ffmpeg turns the frames into `public/media/formulr-onboarding.mp4`:

    ffmpeg -framerate 30 -i frames/f%05d.png -vf "scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libx264 -crf 18 -movflags +faststart formulr-onboarding.mp4

Serve `frontend/public` plus this folder on localhost:4173 before you record.
