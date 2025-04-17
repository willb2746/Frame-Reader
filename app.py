from flask import Flask, render_template, jsonify, request, redirect, url_for, send_from_directory
import re
import os
import json
from collections import defaultdict
from werkzeug.utils import secure_filename
import time
import threading
import datetime

app = Flask(__name__, static_folder="static", template_folder="templates")
app.config['UPLOAD_FOLDER_LOGS'] = 'uploads/logs'
app.config['UPLOAD_FOLDER_AUDIO'] = 'uploads/audio'
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50MB max upload sizeh
app.config['ALLOWED_EXTENSIONS_LOGS'] = {'log', 'txt'}
app.config['ALLOWED_EXTENSIONS_AUDIO'] = {'mp3', 'wav', 'm4a', 'ogg'}
app.config['FILE_EXPIRY_SECONDS'] = 3600  # 1 hour

# Create upload folders if they don't exist
os.makedirs(app.config['UPLOAD_FOLDER_LOGS'], exist_ok=True)
os.makedirs(app.config['UPLOAD_FOLDER_AUDIO'], exist_ok=True)

# Store current file paths
current_log_file = None
current_audio_file = None

# Dictionary to track file upload times
file_upload_times = {}
cleanup_thread = None
cleanup_running = False

def allowed_file(filename, allowed_extensions):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in allowed_extensions

# Function to clean up expired files
def cleanup_files():
    global cleanup_running
    cleanup_running = True
    try:
        while cleanup_running:
            current_time = time.time()
            files_to_remove = []
            
            # Find expired files
            for filepath, upload_time in file_upload_times.items():
                if current_time - upload_time > app.config['FILE_EXPIRY_SECONDS']:
                    files_to_remove.append(filepath)
            
            # Remove expired files
            for filepath in files_to_remove:
                if os.path.exists(filepath):
                    try:
                        os.remove(filepath)
                        print(f"Automatically deleted expired file: {filepath}")
                        # If this is the current file, reset it
                        global current_log_file, current_audio_file
                        if filepath == current_log_file:
                            current_log_file = None
                        elif filepath == current_audio_file:
                            current_audio_file = None
                    except Exception as e:
                        print(f"Error deleting expired file {filepath}: {str(e)}")
                del file_upload_times[filepath]
            
            # Sleep for a while before checking again
            time.sleep(60)  # Check every minute
    except Exception as e:
        print(f"Error in cleanup thread: {str(e)}")
    finally:
        cleanup_running = False

# Start cleanup thread
def start_cleanup_thread():
    global cleanup_thread
    if cleanup_thread is None or not cleanup_thread.is_alive():
        cleanup_thread = threading.Thread(target=cleanup_files, daemon=True)
        cleanup_thread.start()
        print(f"File cleanup thread started at {datetime.datetime.now()}")

# Start the cleanup thread when the application starts
start_cleanup_thread()

def parse_log_file(file_path):
    frames = []
    line_count = 0
    parsed_count = 0
    errors = 0
    
    try:
        with open(file_path, 'r') as f:
            for line in f:
                line_count += 1
                line = line.strip()
                
                # Skip empty lines
                if not line:
                    continue
                    
                try:
                    # Patterns that match the actual log format
                    # Down arrow format (↓) - PRIMARY FORMAT for downstream
                    down_arrow_match = re.match(r'(\d+\.\d+): (\w+): ([^↓]+) ↓ ([^↓]+)', line)
                    
                    # Up arrow format (↑) - PRIMARY FORMAT for upstream
                    up_arrow_match = re.match(r'(\d+\.\d+): (\w+): ([^↑]+) ↑ ([^↑]+)', line)
                    
                    # Standard arrow patterns as fallbacks
                    forward_match = re.match(r'(\d+\.\d+): (\w+): ([^→]+) → ([^→]+)', line)
                    backward_match = re.match(r'(\d+\.\d+): (\w+): ([^←]+) ← ([^←]+)', line)
                    
                    # ASCII arrow format as fallbacks
                    ascii_down_match = re.match(r'(\d+\.\d+): (\w+): (.+) v (.+)', line)
                    ascii_up_match = re.match(r'(\d+\.\d+): (\w+): (.+) \^ (.+)', line)
                    ascii_forward_match = re.match(r'(\d+\.\d+): (\w+): (.+) -> (.+)', line)
                    ascii_backward_match = re.match(r'(\d+\.\d+): (\w+): (.+) <- (.+)', line)
                    
                    # Special patterns for USER_MESSAGE and AI_RESPONSE
                    user_message_match = re.match(r'(\d+\.\d+): (USER|Human): (.+)', line, re.IGNORECASE)
                    ai_response_match = re.match(r'(\d+\.\d+): (AI|Assistant): (.+)', line, re.IGNORECASE)
                    
                    if down_arrow_match:
                        timestamp, frame_type, source, destination = down_arrow_match.groups()
                        direction = "downstream"
                        parsed_count += 1
                    elif up_arrow_match:
                        timestamp, frame_type, source, destination = up_arrow_match.groups()
                        direction = "upstream"
                        parsed_count += 1
                    elif forward_match:
                        timestamp, frame_type, source, destination = forward_match.groups()
                        direction = "downstream"
                        parsed_count += 1
                    elif backward_match:
                        timestamp, frame_type, source, destination = backward_match.groups()
                        direction = "upstream"
                        parsed_count += 1
                    elif ascii_down_match:
                        timestamp, frame_type, source, destination = ascii_down_match.groups()
                        direction = "downstream"
                        parsed_count += 1
                    elif ascii_up_match:
                        timestamp, frame_type, source, destination = ascii_up_match.groups()
                        direction = "upstream"
                        parsed_count += 1
                    elif ascii_forward_match:
                        timestamp, frame_type, source, destination = ascii_forward_match.groups()
                        direction = "downstream"
                        parsed_count += 1
                    elif ascii_backward_match:
                        timestamp, frame_type, source, destination = ascii_backward_match.groups()
                        direction = "upstream"
                        parsed_count += 1
                    elif user_message_match:
                        # Handle user message format
                        timestamp, _, content = user_message_match.groups()
                        frame_type = "USER_MESSAGE"
                        source = "User"
                        destination = "System"
                        direction = "downstream"
                        parsed_count += 1
                    elif ai_response_match:
                        # Handle AI response format
                        timestamp, _, content = ai_response_match.groups()
                        frame_type = "AI_RESPONSE"
                        source = "System"
                        destination = "User"
                        direction = "upstream"
                        parsed_count += 1
                    elif re.match(r'^\d+\.\d+: \w+:', line):
                        # For cases where we recognize the start of a log line but can't parse the rest
                        # Use regex to extract parts
                        parts = line.split(':', 2)
                        if len(parts) >= 3:
                            timestamp = parts[0].strip()
                            frame_type = parts[1].strip()
                            
                            # Try to find components by looking for arrows or separators
                            content = parts[2].strip()
                            component_parts = re.split(r'[↓↑→←v\^\-><]', content)
                            
                            if len(component_parts) >= 2:
                                source = component_parts[0].strip()
                                destination = component_parts[1].strip()
                            else:
                                source = content
                                destination = "unknown"
                            
                            direction = "unknown"
                            parsed_count += 1
                        else:
                            # Skip lines we can't parse
                            errors += 1
                            continue
                    else:
                        # Skip lines that don't match any pattern
                        errors += 1
                        continue
                        
                    # Clean up source and destination (trim spaces)
                    source = source.strip()
                    destination = destination.strip()
                    
                    frames.append({
                        'timestamp': float(timestamp),
                        'type': frame_type,
                        'source': source,
                        'destination': destination,
                        'direction': direction,
                        'raw': line
                    })
                except Exception as e:
                    # If parsing a specific line fails, log it and continue
                    print(f"Error parsing line {line_count}: {line} - {str(e)}")
                    errors += 1
        
        print(f"Log parsing summary: {line_count} total lines, {parsed_count} successfully parsed, {errors} errors")
        
        # Debug - print some example frames
        if frames:
            print(f"Found frame types: {set(frame['type'] for frame in frames)}")
            print(f"Sample sources: {list(set(frame['source'] for frame in frames))[:5]}")
            print(f"Sample destinations: {list(set(frame['destination'] for frame in frames))[:5]}")
        
    except Exception as e:
        print(f"Error reading/parsing log file {file_path}: {str(e)}")
    
    # Sort frames by timestamp
    frames.sort(key=lambda x: x['timestamp'])
    
    return frames

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload')
def upload_page():
    log_files = [f for f in os.listdir(app.config['UPLOAD_FOLDER_LOGS']) 
                if os.path.isfile(os.path.join(app.config['UPLOAD_FOLDER_LOGS'], f))]
    audio_files = [f for f in os.listdir(app.config['UPLOAD_FOLDER_AUDIO']) 
                  if os.path.isfile(os.path.join(app.config['UPLOAD_FOLDER_AUDIO'], f))]
    
    # Calculate expiration times for display
    file_expiry = {}
    current_time = time.time()
    
    # Process log files
    for filename in log_files:
        filepath = os.path.join(app.config['UPLOAD_FOLDER_LOGS'], filename)
        if filepath in file_upload_times:
            elapsed = current_time - file_upload_times[filepath]
            remaining_seconds = max(0, app.config['FILE_EXPIRY_SECONDS'] - elapsed)
            remaining_minutes = int(remaining_seconds / 60)
            file_expiry[filename] = f"Expires in {remaining_minutes} minutes"
        else:
            # For existing files without upload time, set it now
            file_upload_times[filepath] = current_time
            file_expiry[filename] = f"Expires in 60 minutes"
    
    # Process audio files
    for filename in audio_files:
        filepath = os.path.join(app.config['UPLOAD_FOLDER_AUDIO'], filename)
        if filepath in file_upload_times:
            elapsed = current_time - file_upload_times[filepath]
            remaining_seconds = max(0, app.config['FILE_EXPIRY_SECONDS'] - elapsed)
            remaining_minutes = int(remaining_seconds / 60)
            file_expiry[filename] = f"Expires in {remaining_minutes} minutes"
        else:
            # For existing files without upload time, set it now
            file_upload_times[filepath] = current_time
            file_expiry[filename] = f"Expires in 60 minutes"
    
    return render_template('upload.html', 
                          log_files=log_files, 
                          audio_files=audio_files,
                          file_expiry=file_expiry,
                          current_log=os.path.basename(current_log_file) if current_log_file else None,
                          current_audio=os.path.basename(current_audio_file) if current_audio_file else None)

@app.route('/upload_files', methods=['POST'])
def upload_files():
    global current_log_file, current_audio_file
    
    # Check if log file was uploaded
    if 'log_file' in request.files:
        log_file = request.files['log_file']
        if log_file and log_file.filename != '' and allowed_file(log_file.filename, app.config['ALLOWED_EXTENSIONS_LOGS']):
            log_filename = secure_filename(log_file.filename)
            log_path = os.path.join(app.config['UPLOAD_FOLDER_LOGS'], log_filename)
            log_file.save(log_path)
            current_log_file = log_path
            # Add to upload times for auto-deletion
            file_upload_times[log_path] = time.time()
            print(f"Uploaded log file: {current_log_file} (expires in 1 hour)")
            # Read a few lines to verify the log file format
            try:
                with open(current_log_file, 'r') as f:
                    sample = f.read(500)
                    print(f"Log file sample: {sample[:200]}")
            except Exception as e:
                print(f"Error reading uploaded log file: {str(e)}")
    
    # Check if audio file was uploaded
    if 'audio_file' in request.files:
        audio_file = request.files['audio_file']
        if audio_file and audio_file.filename != '' and allowed_file(audio_file.filename, app.config['ALLOWED_EXTENSIONS_AUDIO']):
            audio_filename = secure_filename(audio_file.filename)
            audio_path = os.path.join(app.config['UPLOAD_FOLDER_AUDIO'], audio_filename)
            audio_file.save(audio_path)
            current_audio_file = audio_path
            # Add to upload times for auto-deletion
            file_upload_times[audio_path] = time.time()
            print(f"Uploaded audio file: {current_audio_file} (expires in 1 hour)")
    
    # Alternative: select existing files
    if 'selected_log' in request.form and request.form['selected_log']:
        selected_log = request.form['selected_log']
        current_log_file = os.path.join(app.config['UPLOAD_FOLDER_LOGS'], selected_log)
        print(f"Selected log file: {current_log_file}")
    
    if 'selected_audio' in request.form and request.form['selected_audio']:
        selected_audio = request.form['selected_audio']
        current_audio_file = os.path.join(app.config['UPLOAD_FOLDER_AUDIO'], selected_audio)
        print(f"Selected audio file: {current_audio_file}")
    
    # Verify files exist
    if current_log_file and not os.path.exists(current_log_file):
        print(f"Warning: Selected log file does not exist: {current_log_file}")
        # Try to find the file by just the basename
        basename = os.path.basename(current_log_file)
        alternative_path = os.path.join(app.config['UPLOAD_FOLDER_LOGS'], basename)
        if os.path.exists(alternative_path):
            print(f"Found log file in uploads folder: {alternative_path}")
            current_log_file = alternative_path
    
    if current_audio_file and not os.path.exists(current_audio_file):
        print(f"Warning: Selected audio file does not exist: {current_audio_file}")
        # Try to find the file by just the basename
        basename = os.path.basename(current_audio_file)
        alternative_path = os.path.join(app.config['UPLOAD_FOLDER_AUDIO'], basename)
        if os.path.exists(alternative_path):
            print(f"Found audio file in uploads folder: {alternative_path}")
            current_audio_file = alternative_path
    
    return redirect(url_for('index'))

@app.route('/api/frames')
def get_frames():
    global current_log_file
    
    if not current_log_file:
        # If no log file is selected, try to use a default one
        default_log = "84bec4d9-bd4b-4097-9d57-8067a01441b5_pipeline_debug (2).log"
        if os.path.exists(default_log):
            print(f"Using default log file: {default_log}")
            frames = parse_log_file(default_log)
        else:
            print(f"Default log file not found: {default_log}")
            return jsonify([])
    else:
        if not os.path.exists(current_log_file):
            print(f"ERROR: Selected log file does not exist: {current_log_file}")
            # Try to look in uploads folder
            basename = os.path.basename(current_log_file)
            alternative_path = os.path.join(app.config['UPLOAD_FOLDER_LOGS'], basename)
            if os.path.exists(alternative_path):
                print(f"Found log file at alternative path: {alternative_path}")
                current_log_file = alternative_path
            else:
                print(f"Log file not found at alternative path either: {alternative_path}")
                return jsonify([])
        
        print(f"Parsing log file: {current_log_file}")
        frames = parse_log_file(current_log_file)
        print(f"Parsed {len(frames)} frames")
    
    # Debug - print the first few frames
    if frames:
        for i in range(min(3, len(frames))):
            print(f"Sample frame {i}: {frames[i]}")
    
    return jsonify(frames)

@app.route('/api/frame-types')
def get_frame_types():
    if not current_log_file:
        # If no log file is selected, try to use a default one
        default_log = "84bec4d9-bd4b-4097-9d57-8067a01441b5_pipeline_debug (2).log"
        if os.path.exists(default_log):
            frames = parse_log_file(default_log)
        else:
            return jsonify([])
    else:
        frames = parse_log_file(current_log_file)
    
    frame_types = list(set(frame['type'] for frame in frames))
    return jsonify(frame_types)

@app.route('/api/components')
def get_components():
    if not current_log_file:
        # If no log file is selected, try to use a default one
        default_log = "84bec4d9-bd4b-4097-9d57-8067a01441b5_pipeline_debug (2).log"
        if os.path.exists(default_log):
            frames = parse_log_file(default_log)
        else:
            return jsonify([])
    else:
        frames = parse_log_file(current_log_file)
    
    components = set()
    for frame in frames:
        components.add(frame.get('source', ''))
        components.add(frame.get('destination', ''))
    
    return jsonify(list(components))

@app.route('/api/current-files')
def get_current_files():
    return jsonify({
        'log_file': os.path.basename(current_log_file) if current_log_file else None,
        'audio_file': os.path.basename(current_audio_file) if current_audio_file else None,
        'audio_path': url_for('get_audio', filename=os.path.basename(current_audio_file)) if current_audio_file else None
    })

@app.route('/uploads/audio/<filename>')
def get_audio(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER_AUDIO'], filename)

# Add debugging route to check file loading status
@app.route('/api/debug-info')
def get_debug_info():
    log_exists = False
    log_content = ""
    
    if current_log_file and os.path.exists(current_log_file):
        log_exists = True
        with open(current_log_file, 'r') as f:
            log_content = f.read(500)  # First 500 chars
    
    return jsonify({
        'current_log_file': current_log_file,
        'log_exists': log_exists,
        'log_sample': log_content
    })

@app.route('/reset')
def reset_state():
    global current_log_file, current_audio_file
    current_log_file = None
    current_audio_file = None
    return redirect(url_for('index'))

@app.route('/api/files')
def list_files():
    log_files = []
    audio_files = []
    
    # List log files with their remaining time
    for f in os.listdir(app.config['UPLOAD_FOLDER_LOGS']):
        filepath = os.path.join(app.config['UPLOAD_FOLDER_LOGS'], f)
        if os.path.isfile(filepath):
            # Calculate remaining time
            remaining_seconds = 0
            if filepath in file_upload_times:
                elapsed = time.time() - file_upload_times[filepath]
                remaining_seconds = max(0, app.config['FILE_EXPIRY_SECONDS'] - elapsed)
                remaining_minutes = int(remaining_seconds / 60)
            else:
                # If we don't know the upload time, set it now
                file_upload_times[filepath] = time.time()
                remaining_minutes = int(app.config['FILE_EXPIRY_SECONDS'] / 60)
            
            log_files.append({
                'name': f,
                'remaining_minutes': remaining_minutes
            })
    
    # List audio files with their remaining time
    for f in os.listdir(app.config['UPLOAD_FOLDER_AUDIO']):
        filepath = os.path.join(app.config['UPLOAD_FOLDER_AUDIO'], f)
        if os.path.isfile(filepath):
            # Calculate remaining time
            remaining_seconds = 0
            if filepath in file_upload_times:
                elapsed = time.time() - file_upload_times[filepath]
                remaining_seconds = max(0, app.config['FILE_EXPIRY_SECONDS'] - elapsed)
                remaining_minutes = int(remaining_seconds / 60)
            else:
                # If we don't know the upload time, set it now
                file_upload_times[filepath] = time.time()
                remaining_minutes = int(app.config['FILE_EXPIRY_SECONDS'] / 60)
            
            audio_files.append({
                'name': f,
                'remaining_minutes': remaining_minutes
            })
    
    return jsonify({
        'log_files': log_files,
        'audio_files': audio_files
    })

@app.route('/delete_file', methods=['POST'])
def delete_file():
    global current_log_file, current_audio_file
    
    file_type = request.form.get('file_type')
    filename = request.form.get('filename')
    
    if not file_type or not filename:
        return jsonify({'success': False, 'error': 'Missing file_type or filename parameter'}), 400
    
    if file_type == 'log':
        file_path = os.path.join(app.config['UPLOAD_FOLDER_LOGS'], filename)
        if current_log_file and os.path.basename(current_log_file) == filename:
            current_log_file = None
    elif file_type == 'audio':
        file_path = os.path.join(app.config['UPLOAD_FOLDER_AUDIO'], filename)
        if current_audio_file and os.path.basename(current_audio_file) == filename:
            current_audio_file = None
    else:
        return jsonify({'success': False, 'error': 'Invalid file_type parameter'}), 400
    
    try:
        if os.path.exists(file_path):
            os.remove(file_path)
            return jsonify({'success': True, 'message': f'{file_type.capitalize()} file {filename} deleted successfully'})
        else:
            return jsonify({'success': False, 'error': 'File not found'}), 404
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    # Ensure cleanup thread is started
    start_cleanup_thread()
    app.run(debug=True, port=5005) 