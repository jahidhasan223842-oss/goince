#!/usr/bin/env python3
"""
Goince - Product Video (unique every generation, no black screen)
"""

import argparse
import os
import sys
import random
import subprocess
from pathlib import Path

WIDTH = 1080
HEIGHT = 1920
FPS = 30
FADE_DURATION = 0.35
MUSIC_FOLDER = Path(__file__).parent.parent / "public" / "music"
OUTPUT_FOLDER = Path(__file__).parent.parent / "public" / "videos"
LOGO_PATH = Path(__file__).parent.parent / "public" / "images" / "invoice-logo.png"

def check_ffmpeg():
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except Exception:
        print("ERROR: ffmpeg not found.", file=sys.stderr)
        return False

def get_music_file():
    if not MUSIC_FOLDER.exists():
        return None
    files = list(MUSIC_FOLDER.glob("*.mp3")) + list(MUSIC_FOLDER.glob("*.m4a")) + list(MUSIC_FOLDER.glob("*.wav"))
    if not files:
        return None
    return str(random.choice(files))

def create_video(images, product_name, price, output_path, short_desc=""):
    if not images:
        print("ERROR: No images provided", file=sys.stderr)
        return False

    valid_images = [img for img in images if os.path.isfile(img)]
    if not valid_images:
        print("ERROR: No valid image files found", file=sys.stderr)
        return False

    # Unique: shuffle order
    random.shuffle(valid_images)

    # Unique: random duration per image
    durations = [round(random.uniform(2.6, 3.8), 2) for _ in valid_images]
    total_duration = sum(durations)

    music = get_music_file()
    has_logo = LOGO_PATH.exists()
    n = len(valid_images)

    # Unique: logo position + pad color + brightness
    logo_x = random.randint(18, 50)
    logo_y = random.randint(18, 50)
    pad_color = random.choice(["black", "0x0a0a0a", "0x121212", "0x0d0d10"])
    brightness = round(random.uniform(-0.03, 0.05), 3)
    saturation = round(random.uniform(0.95, 1.12), 3)

    inputs = []
    filter_parts = []

    for i, img in enumerate(valid_images):
        inputs.extend(["-loop", "1", "-t", str(durations[i]), "-i", img])

    # Scale to FIT (full photo visible)
    for i in range(n):
        filter_parts.append(
            f"[{i}:v]scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease,setsar=1[s{i}]"
        )

    if has_logo:
        logo_idx = n
        logo_outs = "".join([f"[logo{i}]" for i in range(n)])
        filter_parts.append(
            f"[{logo_idx}:v]scale=140:-1,colorkey=0x000000:0.35:0.15,format=rgba,split={n}{logo_outs}"
        )
        for i in range(n):
            dur = durations[i]
            filter_parts.append(
                f"[s{i}][logo{i}]overlay={logo_x}:{logo_y}:format=auto,"
                f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:{pad_color},fps={FPS},"
                f"eq=brightness={brightness}:saturation={saturation},"
                f"fade=t=in:st=0:d={FADE_DURATION},fade=t=out:st={max(dur-FADE_DURATION,0.1)}:d={FADE_DURATION}[v{i}]"
            )
    else:
        for i in range(n):
            dur = durations[i]
            filter_parts.append(
                f"[s{i}]pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:{pad_color},fps={FPS},"
                f"eq=brightness={brightness}:saturation={saturation},"
                f"fade=t=in:st=0:d={FADE_DURATION},fade=t=out:st={max(dur-FADE_DURATION,0.1)}:d={FADE_DURATION}[v{i}]"
            )

    concat_inputs = "".join([f"[v{i}]" for i in range(n)])
    filter_parts.append(f"{concat_inputs}concat=n={n}:v=1:a=0[vout]")

    safe_name = product_name.replace(":", "\\:").replace("'", "\\'").replace("%", "\\%")[:40]
    safe_price = f"Tk {price}"

    # Unique: slight text vertical offset
    text_y1 = 220 + random.randint(-8, 8)
    text_y2 = 140 + random.randint(-6, 6)

    filter_parts.append(
        f"[vout]drawbox=x=0:y=ih-280:w=iw:h=280:color=black@0.55:t=fill,"
        f"drawtext=text='{safe_name}':fontcolor=white:fontsize=52:x=(w-text_w)/2:y=h-{text_y1}:"
        f"font='Arial':borderw=2:bordercolor=black@0.6,"
        f"drawtext=text='{safe_price}':fontcolor=#f0a500:fontsize=64:x=(w-text_w)/2:y=h-{text_y2}:"
        f"font='Arial':borderw=2:bordercolor=black@0.6[vfinal]"
    )

    filter_complex = ";".join(filter_parts)

    cmd = ["ffmpeg", "-y"]
    cmd.extend(inputs)

    if has_logo:
        cmd.extend(["-i", str(LOGO_PATH)])

    if music:
        cmd.extend(["-i", music])
        audio_idx = n + (1 if has_logo else 0)
        music_start = round(random.uniform(0, 10), 2)
        cmd.extend([
            "-filter_complex",
            filter_complex + (
                f";[{audio_idx}:a]atrim=start={music_start},asetpts=PTS-STARTPTS,"
                f"afade=t=in:st=0:d=1,afade=t=out:st={max(total_duration-1.5,0.5)}:d=1.5,volume=0.35[a]"
            ),
            "-map", "[vfinal]",
            "-map", "[a]",
            "-t", str(total_duration),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-c:a", "aac",
            "-b:a", "128k",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(output_path)
        ])
    else:
        cmd.extend([
            "-filter_complex", filter_complex,
            "-map", "[vfinal]",
            "-t", str(total_duration),
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-movflags", "+faststart",
            str(output_path)
        ])

    print("Running ffmpeg (unique, safe)...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print("FFmpeg Error:", result.stderr[-2500:], file=sys.stderr)
        return False

    print(f"SUCCESS: Unique video -> {output_path}")
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--product-id", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--price", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--short-desc", default="")
    args = parser.parse_args()

    if not check_ffmpeg():
        sys.exit(1)

    OUTPUT_FOLDER.mkdir(parents=True, exist_ok=True)
    images = [p.strip() for p in args.images.split(",") if p.strip()]

    ok = create_video(
        images=images,
        product_name=args.name,
        price=args.price,
        output_path=args.output,
        short_desc=args.short_desc
    )
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
