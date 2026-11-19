#!/bin/sh
# compose.sh <dir> <mode> : darken the foot of the tall covers, then lay the title over each render with a soft halo
cd "$1" || exit 1
for n in landscape portrait square; do
  sg=$([ "$2" = final ] && echo 22 || echo 9)
  g=$([ "$n" = landscape ] && echo 0 || echo 215)
  size=$(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$n-$2.png")
  ffmpeg -loglevel error -y -i "$n-$2.png" -i "$n-text-$2.png" -f lavfi -i "color=c=black:s=$size:d=1,format=rgba,geq=r=0:g=0:b=0:a='$g*clip((Y/H-0.58)/0.3\,0\,1)'" -filter_complex \
   "[1]split=3[t][s1][s2];[s1]colorchannelmixer=rr=0:rg=0:rb=0:gr=0:gg=0:gb=0:br=0:bg=0:bb=0,gblur=sigma=$sg[h1];[s2]colorchannelmixer=rr=0:rg=0:rb=0:gr=0:gg=0:gb=0:br=0:bg=0:bb=0,gblur=sigma=$((sg/4+1))[h2];[0][2]overlay[g];[g][h1]overlay[a];[a][h2]overlay[c];[c][t]overlay,format=rgb24" -frames:v 1 "$n-$2-titled.png" || exit 1
done
