# Speak each line with Kokoro (free, open-weight, runs on the CPU): python tts.py <lines.json> <out_dir> [voice]
# Writes out_dir/<i>.wav (48 kHz mono, silence trimmed) and prints JSON with each line's length in seconds.
# The model files (kokoro-v1.0.onnx, voices-v1.0.bin) live in KOKORO_DIR; see README.md.
import json, os, subprocess, sys
import numpy as np, soundfile as sf
from kokoro_onnx import Kokoro

lines = json.load(open(sys.argv[1])); out = sys.argv[2]; voice = sys.argv[3] if len(sys.argv) > 3 else 'am_michael'
d = os.environ.get('KOKORO_DIR', os.path.dirname(os.path.abspath(__file__)))
k = Kokoro(f'{d}/kokoro-v1.0.onnx', f'{d}/voices-v1.0.bin')
os.makedirs(out, exist_ok=True); res = []
for i, text in enumerate(lines):
    a, sr = k.create(text, voice=voice, speed=float(os.environ.get('TTS_SPEED', '1.12')), lang='en-gb' if voice.startswith('b') else 'en-us')
    loud = np.where(np.abs(a) > 0.02)[0]  # trim the silence around the line
    if len(loud): a = a[max(0, loud[0] - int(0.03 * sr)):loud[-1] + int(0.08 * sr)]
    tmp = f'{out}/{i}-raw.wav'; sf.write(tmp, a, sr, subtype='PCM_16')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', tmp, '-ar', '48000', '-ac', '1', f'{out}/{i}.wav'], check=True); os.remove(tmp)
    res.append(round(len(a) / sr, 3))
print(json.dumps(res))
