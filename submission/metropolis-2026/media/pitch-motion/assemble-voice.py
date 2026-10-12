"""Place the seven pitch narration clips on a 118-second timeline."""
from pathlib import Path
import wave

HERE = Path(__file__).resolve().parent
DURATIONS = [16, 18, 18, 12, 18, 18, 18]
RATE = 24000
timeline = bytearray(sum(DURATIONS) * RATE * 2)
start = 0
for number, duration in enumerate(DURATIONS, 1):
    with wave.open(str(HERE / "voice" / f"{number:02d}.wav"), "rb") as source:
        assert (source.getframerate(), source.getnchannels(), source.getsampwidth()) == (RATE, 1, 2)
        frames = source.readframes(source.getnframes())
    assert len(frames) <= (duration - 0.25) * RATE * 2, f"Narration {number} exceeds its scene"
    offset = int((start + 0.25) * RATE) * 2
    timeline[offset:offset + len(frames)] = frames
    start += duration
with wave.open(str(HERE / "narration-timeline.wav"), "wb") as output:
    output.setnchannels(1)
    output.setsampwidth(2)
    output.setframerate(RATE)
    output.writeframes(timeline)
