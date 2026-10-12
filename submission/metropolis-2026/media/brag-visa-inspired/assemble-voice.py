"""Place the seven approved narration clips on the 124-second film timeline."""
from pathlib import Path
import wave

HERE = Path(__file__).resolve().parent
DURATIONS = [16, 18, 18, 18, 18, 18, 18]
RATE = 24000
CHANNELS = 1
WIDTH = 2

timeline = bytearray(sum(DURATIONS) * RATE * CHANNELS * WIDTH)
start = 0
for number, duration in enumerate(DURATIONS, 1):
    with wave.open(str(HERE / "voice" / f"{number:02d}.wav"), "rb") as source:
        assert (source.getframerate(), source.getnchannels(), source.getsampwidth()) == (
            RATE,
            CHANNELS,
            WIDTH,
        )
        frames = source.readframes(source.getnframes())
    offset = int((start + 0.28) * RATE) * CHANNELS * WIDTH
    assert len(frames) <= duration * RATE * CHANNELS * WIDTH
    timeline[offset : offset + len(frames)] = frames
    start += duration

with wave.open(str(HERE / "narration-timeline.wav"), "wb") as output:
    output.setnchannels(CHANNELS)
    output.setsampwidth(WIDTH)
    output.setframerate(RATE)
    output.writeframes(timeline)
