# Frame Reader

A visualization and analysis tool for conversation frames with audio synchronization capabilities.

## Features

- Timeline visualization of conversation frames
- Audio waveform display with dual-channel visualization
- Latency measurement between user and AI messages
- Synchronized playback of audio with frame data
- Collapsible filter sections for frame types and components
- Responsive design for different screen sizes

## Setup

1. Clone the repository
2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```
3. Run the application:
   ```
   python app.py
   ```
4. Open your browser and navigate to `http://localhost:5005`

## Usage

1. Upload a log file (.log or .txt) containing conversation frames
2. Optionally upload an audio file (.mp3, .wav, .m4a, or .ogg) to synchronize with frames
3. Use the filters to focus on specific frame types, components, or directions
4. Use the timeline to navigate through the conversation
5. Press 'L' to toggle latency visualization on the waveform

## File Format

The application expects log files with frames in the format:
```
timestamp: frame_type: source ↓ destination
timestamp: frame_type: source ↑ destination
```

## Credits

Created by Will Bodewes 