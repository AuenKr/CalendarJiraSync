#!/usr/bin/env bash
set -euo pipefail

max_files="${1:-5}"
size="${2:-1280x800}"
output_dir="${3:-converted}"

if ! [[ "$max_files" =~ ^[0-9]+$ ]]; then
  printf 'max_files must be a number\n' >&2
  exit 1
fi

if (( max_files < 1 || max_files > 5 )); then
  printf 'max_files must be between 1 and 5\n' >&2
  exit 1
fi

if [[ "$size" != "1280x800" && "$size" != "640x400" ]]; then
  printf 'size must be 1280x800 or 640x400\n' >&2
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  printf 'ffmpeg is required but not installed\n' >&2
  exit 1
fi

width="${size%x*}"
height="${size#*x}"

mkdir -p "$output_dir"
rm -f "$output_dir"/*.png

shopt -s nullglob
files=( *.png *.jpg *.jpeg *.webp )

count=0
for f in "${files[@]}"; do
  [[ -f "$f" ]] || continue
  base="${f%.*}"
  out="$output_dir/$base.png"

  ffmpeg -y -i "$f" \
    -vf "scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=white,format=rgb24" \
    -frames:v 1 "$out" >/dev/null 2>&1

  count=$((count + 1))
  if (( count >= max_files )); then
    break
  fi
done

if (( count == 0 )); then
  printf 'No source images found in current directory\n' >&2
  exit 1
fi

printf 'Created %d image(s) in %s at %s\n' "$count" "$output_dir" "$size"
