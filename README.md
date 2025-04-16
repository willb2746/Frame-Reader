# Frame Viewer

A simple, dark mode UI for viewing and filtering pipeline frames from a log file, with audio synchronization capabilities.

## Features

- Dark mode UI
- View all frames in a scrollable list
- Filter frames by type, component, and direction
- Interactive timeline with markers
- Search for specific components
- Audio playback synchronized with frames
- File upload for log files and audio recordings

## Setup

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Run the application:

```bash
python app.py
```

3. Open your browser and navigate to:

```
http://127.0.0.1:5000
```

## Usage

### Frame Viewer
- **Frame Types Filter**: Click on frame types to filter the displayed frames
- **Components Filter**: Search and select components to filter frames
- **Direction Filter**: Filter based on upstream or downstream direction
- **Timeline**: Click on timeline markers to show frames at that specific timestamp
- **Frame List**: View detailed information about each frame
- **Playback Controls**: Play/pause, step forward/backward through frames

### Audio Synchronization
- **Audio Playback**: When an audio file is loaded, it will play in sync with the frames
- **Sync Toggle**: Press the 's' key to toggle audio synchronization on/off
- **Speed Control**: Adjust playback speed with the speed selector (affects both frame and audio playback)

### File Upload
- Navigate to the Upload page to add new log files and audio recordings
- Upload new files or select from previously uploaded files
- System will automatically associate the selected log and audio files

## Notes

The application parses log files matching the format: `timestamp: frame_type: source → destination`

Audio files and log files are stored in the `uploads/audio` and `uploads/logs` directories respectively. 