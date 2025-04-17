document.addEventListener('DOMContentLoaded', () => {
    // State variables
    let allFrames = [];
    let filteredFrames = [];
    let activeFrameTypes = new Set();
    let activeComponents = new Set();
    let activeDirections = new Set();
    let maxTimestamp = 0;
    let currentFrameIndex = 0;
    let isPlaying = false;
    let playbackInterval = null;
    let framesAtTimestamps = {};
    let audioPlayer = null;
    let audioLoaded = false;
    let audioSyncEnabled = false;
    let audioOffset = 0; // Offset between audio and frames (in seconds)
    let waveformCanvas = null;
    let waveformProgress = null;
    let waveformStartTime = null;
    let waveformEndTime = null;
    let audioContext = null;
    let audioBuffer = null;
    let waveformData = [];
    let latencyData = []; // Array to store latency measurements
    let isShowingLatency = true; // Whether to show latency on the waveform

    // DOM elements
    const framesList = document.getElementById('frames-list');
    const timeSlider = document.getElementById('time-slider');
    const currentTimeElement = document.getElementById('current-time');
    const maxTimeElement = document.getElementById('max-time');
    const playBtn = document.getElementById('play-btn');
    const pauseBtn = document.getElementById('pause-btn');
    const stepBackBtn = document.getElementById('step-back-btn');
    const stepForwardBtn = document.getElementById('step-forward-btn');
    const speedSelect = document.getElementById('speed-select');
    let totalFramesElement = document.getElementById('total-frames');
    let filteredFramesElement = document.getElementById('filtered-frames');
    let currentLogFile = document.getElementById('current-log-file');
    let syncStatus = document.getElementById('sync-status');
    let debugButton = document.getElementById('debug-btn');
    let audioContainer = document.getElementById('audio-container');
    let audioFilename = document.getElementById('audio-filename');
    
    // Initialize collapsible sections
    initializeCollapsibleSections();

    // Initialize audio player
    audioPlayer = document.getElementById('audio-player');
    waveformCanvas = document.getElementById('waveform-canvas');
    waveformProgress = document.getElementById('waveform-progress');
    waveformStartTime = document.getElementById('waveform-start-time');
    waveformEndTime = document.getElementById('waveform-end-time');
    
    // Load audio player
    audioPlayer.addEventListener('loadedmetadata', () => {
        audioLoaded = true;
        audioSyncEnabled = true;
        syncStatus.textContent = 'Audio Sync: ON';
        
        // Update waveform time markers
        waveformStartTime.textContent = formatTime(0);
        waveformEndTime.textContent = formatTime(audioPlayer.duration);
        
        // Ensure max timestamp is at least the audio duration
        if (audioPlayer.duration && !isNaN(audioPlayer.duration)) {
            if (maxTimestamp < audioPlayer.duration) {
                maxTimestamp = audioPlayer.duration;
                timeSlider.max = maxTimestamp * 1000;
                maxTimeElement.textContent = maxTimestamp.toFixed(3);
            }
        }
        
        // Generate waveform if we haven't already
        if (waveformData.length === 0) {
            generateWaveform();
        }
    });
    
    // Update time display and waveform progress during audio playback
    audioPlayer.addEventListener('timeupdate', () => {
        if (!audioLoaded) return;
        
        // Update waveform progress
        const progressPercent = (audioPlayer.currentTime / audioPlayer.duration) * 100;
        waveformProgress.style.width = progressPercent + '%';
        
        if (!audioSyncEnabled) return;
        
        // Calculate corresponding frame time (audio time + offset)
        const frameTime = audioPlayer.currentTime + audioOffset;
        
        // Update time slider to match audio position
        timeSlider.value = frameTime * 1000;
        currentTimeElement.textContent = frameTime.toFixed(3);
        
        // Find and highlight frames at this time
        const framesAtTime = findFramesAtOrNearTime(frameTime);
        if (framesAtTime.length > 0) {
            highlightFramesAtTime(framesAtTime[0].timestamp);
            
            // Scroll to the current frame for better visibility
            scrollToCurrentFrame();
        }
    });
    
    // Check for current files
    fetch('/api/current-files')
        .then(response => response.json())
        .then(data => {
            if (data.log_file) {
                currentLogFile.textContent = `Log File: ${data.log_file}`;
            }
            
            if (data.audio_file && data.audio_path) {
                audioFilename.textContent = data.audio_file;
                
                // Update all source elements for better compatibility
                const audioSources = audioPlayer.querySelectorAll('source');
                audioSources.forEach(source => {
                    source.src = data.audio_path;
                });
                
                // Also set the src attribute directly for browsers that need it
                audioPlayer.src = data.audio_path;
                audioPlayer.load(); // Important to reload after changing sources
                
                // Show the audio container
                audioContainer.style.display = 'flex';
                console.log("Audio loaded:", data.audio_file);
                
                // Handle clicks on the waveform to seek the audio
                if (waveformCanvas) {
                    waveformCanvas.addEventListener('click', (e) => {
                        if (!audioPlayer.duration) return;
                        
                        const rect = waveformCanvas.getBoundingClientRect();
                        const clickX = e.clientX - rect.left;
                        const seekPercentage = clickX / rect.width;
                        const seekTime = seekPercentage * audioPlayer.duration;
                        
                        // Set audio time
                        audioPlayer.currentTime = seekTime;
                        
                        // Update waveform progress
                        waveformProgress.style.width = (seekPercentage * 100) + '%';
                        
                        // If audio sync is enabled, update frames
                        if (audioSyncEnabled) {
                            const frameTime = seekTime + audioOffset;
                            const framesAtTime = findFramesAtOrNearTime(frameTime);
                            if (framesAtTime.length > 0) {
                                highlightFramesAtTime(framesAtTime[0].timestamp);
                                scrollToCurrentFrame();
                            }
                        }
                    });
                    
                    // Initialize waveform when audio is loaded
                    setTimeout(() => {
                        if (audioPlayer.readyState >= 2) {
                            generateWaveform();
                        }
                    }, 500);
                }
            }
        })
        .catch(error => console.error('Error fetching current files:', error));

    // Fetch all data
    Promise.all([
        fetch('/api/frames').then(response => response.json()),
        fetch('/api/frame-types').then(response => response.json()),
        fetch('/api/components').then(response => response.json())
    ]).then(([frames, frameTypes, components]) => {
        allFrames = frames;
        filteredFrames = [...allFrames];
        
        // Check if we have any frames
        if (frames.length === 0) {
            console.error("No frames loaded! Please check your log file.");
            if (currentLogFile) {
                currentLogFile.innerHTML = `<span style="color: var(--error-color);">No frames loaded! Please check your log file or upload a new one.</span>`;
            }
            return;
        }
        
        console.log(`Loaded ${frames.length} frames, ${frameTypes.length} frame types, ${components.length} components`);
        
        // Find the max timestamp for timeline scaling
        maxTimestamp = Math.max(...frames.map(frame => frame.timestamp));
        
        // Set up time slider
        timeSlider.max = maxTimestamp * 1000; // Convert to milliseconds for precision
        maxTimeElement.textContent = maxTimestamp.toFixed(3);
        
        // Group frames by timestamp
        allFrames.forEach(frame => {
            if (!framesAtTimestamps[frame.timestamp]) {
                framesAtTimestamps[frame.timestamp] = [];
            }
            framesAtTimestamps[frame.timestamp].push(frame);
        });
        
        // Calculate latency data if available
        calculateLatencyData();
        
        // Initialize UI
        initializeFrameTypeFilters(frameTypes);
        initializeComponentFilters(components);
        initializeDirectionFilters();
        initializePlaybackControls();
        updateStats();
        renderFrames();
    }).catch(error => {
        console.error('Error fetching data:', error);
        if (currentLogFile) {
            currentLogFile.innerHTML = `<span style="color: var(--error-color);">Error loading frames: ${error.message}</span>`;
        }
    });

    // Initialize frame type filters
    function initializeFrameTypeFilters(frameTypes) {
        const frameTypeFilters = document.getElementById('frame-type-filters');
        frameTypeFilters.innerHTML = '';
        frameTypes.forEach(type => {
            const chip = createFilterChip(type);
            chip.addEventListener('click', () => {
                toggleFrameTypeFilter(type, chip);
            });
            frameTypeFilters.appendChild(chip);
        });
        
        // Reset button
        const resetFrameTypesBtn = document.getElementById('reset-frame-types');
        resetFrameTypesBtn.addEventListener('click', () => {
            activeFrameTypes.clear();
            Array.from(frameTypeFilters.children).forEach(chip => {
                chip.classList.remove('active');
            });
            applyFilters();
        });
    }

    // Initialize component filters
    function initializeComponentFilters(components) {
        const componentFilters = document.getElementById('component-filters');
        componentFilters.innerHTML = '';
        components.sort().forEach(component => {
            const chip = createFilterChip(component);
            chip.addEventListener('click', () => {
                toggleComponentFilter(component, chip);
            });
            componentFilters.appendChild(chip);
            
            // Initially hide all components to avoid cluttering the UI
            chip.style.display = 'none';
        });

        // Component search
        const componentSearch = document.getElementById('component-search');
        componentSearch.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();
            Array.from(componentFilters.children).forEach(chip => {
                const componentName = chip.textContent.toLowerCase();
                chip.style.display = componentName.includes(searchTerm) ? 'flex' : 'none';
            });
        });
        
        // Reset button
        const resetComponentsBtn = document.getElementById('reset-components');
        resetComponentsBtn.addEventListener('click', () => {
            activeComponents.clear();
            Array.from(componentFilters.children).forEach(chip => {
                chip.classList.remove('active');
            });
            applyFilters();
        });
    }
    
    // Initialize direction filters
    function initializeDirectionFilters() {
        const downstreamFilter = document.getElementById('downstream-filter');
        const upstreamFilter = document.getElementById('upstream-filter');
        
        downstreamFilter.addEventListener('click', () => {
            toggleDirectionFilter('downstream', downstreamFilter);
        });
        
        upstreamFilter.addEventListener('click', () => {
            toggleDirectionFilter('upstream', upstreamFilter);
        });
        
        // Reset button
        const resetDirectionBtn = document.getElementById('reset-direction');
        resetDirectionBtn.addEventListener('click', () => {
            activeDirections.clear();
            downstreamFilter.classList.remove('active');
            upstreamFilter.classList.remove('active');
            applyFilters();
        });
    }
    
    // Initialize playback controls
    function initializePlaybackControls() {
        // Toggle timeline section visibility
        const timelineToggleBtn = document.getElementById('timeline-toggle');
        const timelineSection = document.querySelector('.timeline-section');
        
        if (timelineToggleBtn && timelineSection) {
            // Check if we have a saved preference
            const isTimelineCollapsed = localStorage.getItem('timeline_collapsed') === 'true';
            
            // Apply initial state
            if (isTimelineCollapsed) {
                timelineSection.classList.add('collapsed');
                timelineToggleBtn.innerHTML = '<i class="fas fa-chevron-down"></i>';
            }
            
            // Add click event
            timelineToggleBtn.addEventListener('click', () => {
                timelineSection.classList.toggle('collapsed');
                const isNowCollapsed = timelineSection.classList.contains('collapsed');
                
                // Update button icon
                timelineToggleBtn.innerHTML = isNowCollapsed 
                    ? '<i class="fas fa-chevron-down"></i>' 
                    : '<i class="fas fa-chevron-up"></i>';
                
                // Save preference
                localStorage.setItem('timeline_collapsed', isNowCollapsed);
            });
        }
        
        // Play/Pause buttons
        playBtn.addEventListener('click', () => {
            startPlayback();
        });
        
        pauseBtn.addEventListener('click', () => {
            stopPlayback();
        });
        
        // Step buttons
        stepBackBtn.addEventListener('click', () => {
            stepBackward();
        });
        
        stepForwardBtn.addEventListener('click', () => {
            stepForward();
        });
        
        // Time slider
        timeSlider.addEventListener('input', (e) => {
            const time = parseFloat(e.target.value) / 1000;
            currentTimeElement.textContent = time.toFixed(3);
            
            // Update audio player time if sync is enabled
            if (audioSyncEnabled && audioLoaded) {
                audioPlayer.currentTime = Math.max(0, time - audioOffset);
            }
            
            highlightFramesAtTime(time);
        });
        
        // Speed select also affects audio playback
        speedSelect.addEventListener('change', () => {
            const speed = parseFloat(speedSelect.value);
            if (audioLoaded) {
                audioPlayer.playbackRate = speed;
            }
        });
        
        // Toggle audio sync on/off with keyboard shortcut (s key)
        document.addEventListener('keydown', (e) => {
            if (e.key === 's' && audioLoaded) {
                audioSyncEnabled = !audioSyncEnabled;
                syncStatus.textContent = audioSyncEnabled ? 'Audio Sync: ON' : 'Audio Sync: OFF';
            }
        });
        
        // Debug button
        if (debugButton) {
            debugButton.addEventListener('click', () => {
                checkFilesStatus();
            });
        }
        
        // Handle window resize for waveform redrawing
        window.addEventListener('resize', debounce(() => {
            if (waveformData.length > 0 && waveformCanvas) {
                const ctx = waveformCanvas.getContext('2d');
                drawWaveform(ctx);
            }
        }, 250));
        
        // Initialize time display
        currentTimeElement.textContent = '0.000';
    }

    // Debounce function to limit how often a function can be called
    function debounce(func, wait) {
        let timeout;
        return function() {
            const context = this;
            const args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    }

    // Create a filter chip element
    function createFilterChip(label) {
        const chip = document.createElement('div');
        chip.className = 'filter-chip';
        chip.textContent = label;
        return chip;
    }

    // Toggle frame type filter
    function toggleFrameTypeFilter(type, chipElement) {
        if (activeFrameTypes.has(type)) {
            activeFrameTypes.delete(type);
            chipElement.classList.remove('active');
        } else {
            activeFrameTypes.add(type);
            chipElement.classList.add('active');
        }
        applyFilters();
    }

    // Toggle component filter
    function toggleComponentFilter(component, chipElement) {
        if (activeComponents.has(component)) {
            activeComponents.delete(component);
            chipElement.classList.remove('active');
        } else {
            activeComponents.add(component);
            chipElement.classList.add('active');
        }
        applyFilters();
    }
    
    // Toggle direction filter
    function toggleDirectionFilter(direction, chipElement) {
        if (activeDirections.has(direction)) {
            activeDirections.delete(direction);
            chipElement.classList.remove('active');
        } else {
            activeDirections.add(direction);
            chipElement.classList.add('active');
        }
        applyFilters();
    }

    // Apply filters and update UI
    function applyFilters() {
        filteredFrames = allFrames.filter(frame => {
            const typeMatch = activeFrameTypes.size === 0 || activeFrameTypes.has(frame.type);
            const componentMatch = activeComponents.size === 0 || 
                                activeComponents.has(frame.source) || 
                                activeComponents.has(frame.destination);
            const directionMatch = activeDirections.size === 0 || activeDirections.has(frame.direction);
                                
            return typeMatch && componentMatch && directionMatch;
        });
        
        renderFrames();
        updateStats();
        resetPlayback();
    }

    // Render frames in the list
    function renderFrames() {
        framesList.innerHTML = '';
        
        filteredFrames.forEach((frame, index) => {
            const frameElement = document.createElement('div');
            frameElement.className = 'frame-item';
            frameElement.dataset.index = index;
            
            // Create arrow based on direction
            const arrowIcon = frame.direction === 'downstream' ? 
                '<span class="arrow downstream">→</span>' :
                '<span class="arrow upstream">←</span>';
            
            frameElement.innerHTML = `
                <span class="timestamp">${frame.timestamp.toFixed(3)}</span>
                <span class="type">${frame.type}</span>
                <span class="source">${frame.source}</span>
                ${arrowIcon}
                <span class="destination">${frame.destination}</span>
            `;
            
            frameElement.addEventListener('click', () => {
                // Set as current frame and update timeline/slider
                currentFrameIndex = index;
                highlightCurrentFrame();
                timeSlider.value = frame.timestamp * 1000;
                currentTimeElement.textContent = frame.timestamp.toFixed(3);
                
                // Update audio player time if sync is enabled
                if (audioSyncEnabled && audioLoaded) {
                    audioPlayer.currentTime = Math.max(0, frame.timestamp - audioOffset);
                }
            });
            
            framesList.appendChild(frameElement);
        });
    }

    function highlightCurrentFrame() {
        // Remove active class from all frames
        Array.from(framesList.children).forEach(frameElem => {
            frameElem.classList.remove('active');
        });
        
        // Add active class to current frame
        if (framesList.children[currentFrameIndex]) {
            framesList.children[currentFrameIndex].classList.add('active');
        }
    }
    
    function highlightFramesAtTime(time) {
        // Find frames at this exact timestamp
        const framesAtTime = filteredFrames.filter(frame => Math.abs(frame.timestamp - time) < 0.001);
        
        if (framesAtTime.length > 0) {
            // Find the index of the first frame at this timestamp
            currentFrameIndex = filteredFrames.findIndex(frame => Math.abs(frame.timestamp - time) < 0.001);
            highlightCurrentFrame();
            
            // Scroll to the frame
            scrollToCurrentFrame();
        } else {
            // If no exact matches, try to find the closest frame
            const nearestFrames = findFramesAtOrNearTime(time);
            if (nearestFrames.length > 0) {
                // Find the index of this frame
                const nearestFrame = nearestFrames[0];
                currentFrameIndex = filteredFrames.findIndex(frame => frame.timestamp === nearestFrame.timestamp);
                
                highlightCurrentFrame();
                
                // Scroll to the frame
                scrollToCurrentFrame();
            }
        }
    }

    // Update stats display
    function updateStats() {
        totalFramesElement.textContent = `${allFrames.length} frames total`;
        filteredFramesElement.textContent = `${filteredFrames.length} displayed`;
    }

    // Function to check the status of files
    function checkFilesStatus() {
        fetch('/api/files')
            .then(response => response.json())
            .then(data => {
                console.log('File status:', data);
                
                let debugInfo = `
                    <div style="position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); 
                                background: var(--surface-color); padding: 1rem; border-radius: 8px; 
                                box-shadow: 0 0 20px rgba(0,0,0,0.5); z-index: 1000; max-width: 80vw; 
                                max-height: 80vh; overflow: auto;">
                        <h2>File Status Debug</h2>
                        <div style="margin-bottom: 1rem;">
                            <h3>Current Log File:</h3>
                            <p>${data.current_log_file || 'None'}</p>
                            <p>Exists: ${data.current_log_file_exists ? '✅' : '❌'}</p>
                        </div>
                        <div style="margin-bottom: 1rem;">
                            <h3>Current Audio File:</h3>
                            <p>${data.current_audio_file || 'None'}</p>
                            <p>Exists: ${data.current_audio_file_exists ? '✅' : '❌'}</p>
                        </div>
                        <div style="margin-bottom: 1rem;">
                            <h3>Default Log File:</h3>
                            <p>${data.default_log ? data.default_log.name : 'Not found'}</p>
                        </div>
                        <div style="margin-bottom: 1rem;">
                            <h3>Available Log Files:</h3>
                            <ul>
                                ${data.log_files.map(file => `<li>${file.name} (${Math.round(file.size / 1024)} KB)</li>`).join('')}
                            </ul>
                        </div>
                        <div style="margin-bottom: 1rem;">
                            <h3>Available Audio Files:</h3>
                            <ul>
                                ${data.audio_files.map(file => `<li>${file.name} (${Math.round(file.size / 1024)} KB)</li>`).join('')}
                            </ul>
                        </div>
                        <div style="margin-top: 1rem; text-align: center;">
                            <button onclick="this.parentNode.parentNode.remove()" 
                                    style="background: var(--primary-color); color: #000; 
                                           border: none; padding: 0.5rem 1rem; border-radius: 4px; 
                                           cursor: pointer;">Close</button>
                        </div>
                    </div>
                `;
                
                // Create element and append to body
                const debugEl = document.createElement('div');
                debugEl.innerHTML = debugInfo;
                document.body.appendChild(debugEl.firstElementChild);
            })
            .catch(error => {
                console.error('Error checking file status:', error);
                alert('Error checking file status: ' + error.message);
            });
    }

    // Find frames at or near a given time
    function findFramesAtOrNearTime(time) {
        // First try to find exact matches
        const exactMatches = filteredFrames.filter(frame => frame.timestamp === time);
        if (exactMatches.length > 0) {
            return exactMatches;
        }
        
        // If no exact matches, find the closest frame
        // Tolerance threshold (50ms)
        const tolerance = 0.05;
        const nearMatches = filteredFrames.filter(frame => 
            Math.abs(frame.timestamp - time) < tolerance
        );
        
        if (nearMatches.length > 0) {
            // Sort by proximity to the target time
            nearMatches.sort((a, b) => 
                Math.abs(a.timestamp - time) - Math.abs(b.timestamp - time)
            );
            return nearMatches;
        }
        
        // If still no matches, find the next frame
        const laterFrames = filteredFrames.filter(frame => frame.timestamp > time);
        if (laterFrames.length > 0) {
            // Get the frame with the closest timestamp after the given time
            laterFrames.sort((a, b) => a.timestamp - b.timestamp);
            return [laterFrames[0]];
        }
        
        return [];
    }

    // Scroll to the current frame
    function scrollToCurrentFrame() {
        if (framesList.children[currentFrameIndex]) {
            framesList.children[currentFrameIndex].scrollIntoView({ 
                behavior: 'smooth', 
                block: 'nearest' 
            });
        }
    }

    // Generate waveform
    function generateWaveform() {
        if (!audioPlayer.src) return;
        
        const ctx = waveformCanvas.getContext('2d');
        const audioUrl = audioPlayer.src;
        
        // Clear previous waveform
        ctx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
        waveformCanvas.width = waveformCanvas.clientWidth * window.devicePixelRatio;
        waveformCanvas.height = waveformCanvas.clientHeight * window.devicePixelRatio;
        
        // Set up canvas for high DPI displays
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        
        // Fetch the audio file and decode it
        fetch(audioUrl)
            .then(response => response.arrayBuffer())
            .then(arrayBuffer => {
                // Create audio context if needed
                if (!audioContext) {
                    audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                
                // Reset audio context if it's suspended
                if (audioContext.state === 'suspended') {
                    audioContext.resume();
                }
                
                // Decode the audio data
                return audioContext.decodeAudioData(arrayBuffer);
            })
            .then(buffer => {
                audioBuffer = buffer;
                
                // Get the number of channels
                const numChannels = buffer.numberOfChannels;
                
                // Get the audio data from the buffer (both channels if stereo)
                const channel1Data = buffer.getChannelData(0); // Left channel
                const channel2Data = numChannels > 1 ? buffer.getChannelData(1) : channel1Data; // Right channel (or left if mono)
                
                const width = waveformCanvas.clientWidth;
                
                // Calculate how many samples we want to analyze
                // We want enough detail but not too much for performance
                const sampleCount = Math.min(width * 5, channel1Data.length);
                const samplesPerPixel = Math.floor(channel1Data.length / sampleCount);
                
                // Clear any existing waveform data
                waveformData = [];
                
                // Calculate RMS values for chunks of audio for both channels
                for (let i = 0; i < sampleCount; i++) {
                    const startSample = Math.floor(i * samplesPerPixel);
                    const endSample = Math.min(startSample + samplesPerPixel, channel1Data.length);
                    
                    // Process channel 1 (left)
                    let sumOfSquares1 = 0;
                    for (let j = startSample; j < endSample; j++) {
                        const sample = channel1Data[j];
                        sumOfSquares1 += sample * sample;
                    }
                    const rms1 = Math.sqrt(sumOfSquares1 / (endSample - startSample));
                    
                    // Process channel 2 (right)
                    let sumOfSquares2 = 0;
                    for (let j = startSample; j < endSample; j++) {
                        const sample = channel2Data[j];
                        sumOfSquares2 += sample * sample;
                    }
                    const rms2 = Math.sqrt(sumOfSquares2 / (endSample - startSample));
                    
                    // Also keep track of min/max for drawing options
                    let min1 = 1.0, max1 = -1.0;
                    let min2 = 1.0, max2 = -1.0;
                    
                    for (let j = startSample; j < endSample; j++) {
                        const sample1 = channel1Data[j];
                        if (sample1 < min1) min1 = sample1;
                        if (sample1 > max1) max1 = sample1;
                        
                        const sample2 = channel2Data[j];
                        if (sample2 < min2) min2 = sample2;
                        if (sample2 > max2) max2 = sample2;
                    }
                    
                    waveformData.push({ 
                        rms1: rms1,
                        rms2: rms2,
                        min1: min1,
                        max1: max1,
                        min2: min2,
                        max2: max2
                    });
                }
                
                // Draw the waveform
                drawWaveform(ctx);
            })
            .catch(error => {
                console.error('Error generating waveform:', error);
                // Draw a placeholder waveform
                drawPlaceholderWaveform(ctx);
            });
    }

    // Draw the waveform on the canvas
    function drawWaveform(ctx) {
        const width = waveformCanvas.clientWidth;
        const height = waveformCanvas.clientHeight;
        
        // Clear the canvas
        ctx.clearRect(0, 0, width, height);
        
        // Create a nice gradient for channel 1 (orange) - top half
        const gradient1 = ctx.createLinearGradient(0, 0, 0, height/2);
        gradient1.addColorStop(0, '#ff7700');      // Orange at top
        gradient1.addColorStop(0.5, '#ff9900');    // Lighter orange at middle
        gradient1.addColorStop(1, '#ff7700');      // Orange at bottom
        
        // Create a nice gradient for channel 2 (green) - bottom half
        const gradient2 = ctx.createLinearGradient(0, height/2, 0, height);
        gradient2.addColorStop(0, '#00cc66');      // Green at top
        gradient2.addColorStop(0.5, '#33ff99');    // Lighter green at middle
        gradient2.addColorStop(1, '#00cc66');      // Green at bottom
        
        // Calculate the number of bars we can draw
        // Use a mix of bar width and spacing similar to Audacity
        const barWidth = 2;
        const barSpacing = 1;
        const totalBarWidth = barWidth + barSpacing;
        
        // Calculate how many bars we can fit
        const barCount = Math.floor(width / totalBarWidth);
        
        // Normalize based on the highest RMS value
        let maxRMS1 = 0, maxRMS2 = 0;
        for (let i = 0; i < waveformData.length; i++) {
            if (waveformData[i].rms1 > maxRMS1) {
                maxRMS1 = waveformData[i].rms1;
            }
            if (waveformData[i].rms2 > maxRMS2) {
                maxRMS2 = waveformData[i].rms2;
            }
        }
        
        // Add 10% headroom to avoid clipping
        maxRMS1 = maxRMS1 * 1.1;
        maxRMS2 = maxRMS2 * 1.1;
        
        // Draw dividing line
        ctx.strokeStyle = '#555555';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height/2);
        ctx.lineTo(width, height/2);
        ctx.stroke();
        
        // Draw the RMS as bars for both channels
        for (let i = 0; i < barCount; i++) {
            // Map our sample index to our waveform data
            const dataIndex = Math.floor((i / barCount) * waveformData.length);
            
            if (dataIndex >= waveformData.length) continue;
            
            const { rms1, rms2 } = waveformData[dataIndex];
            
            // Calculate bar height based on RMS (audio amplitude) for both channels
            // Use a non-linear scaling to emphasize quiet parts
            const normalizedRMS1 = rms1 / maxRMS1;
            const barHeight1 = Math.max(1, normalizedRMS1 * (height/2) * 0.9);
            
            const normalizedRMS2 = rms2 / maxRMS2;
            const barHeight2 = Math.max(1, normalizedRMS2 * (height/2) * 0.9);
            
            // Calculate position
            const x = i * totalBarWidth;
            
            // Draw the bar for channel 1 (orange) - top half
            // Center it in the top half
            ctx.fillStyle = gradient1;
            ctx.fillRect(x, (height/4) - barHeight1/2, barWidth, barHeight1);
            
            // Draw the bar for channel 2 (green) - bottom half
            // Center it in the bottom half
            ctx.fillStyle = gradient2;
            ctx.fillRect(x, (height*3/4) - barHeight2/2, barWidth, barHeight2);
        }
        
        // Draw latency markers if enabled
        if (isShowingLatency && latencyData.length > 0 && audioPlayer.duration) {
            // Draw the latency areas
            ctx.fillStyle = 'rgba(120, 0, 255, 0.2)';
            ctx.strokeStyle = 'rgba(120, 0, 255, 0.7)';
            ctx.lineWidth = 1;
            
            latencyData.forEach(data => {
                // Calculate positions based on timestamps
                const startX = (data.userTimestamp / audioPlayer.duration) * width;
                const endX = (data.aiTimestamp / audioPlayer.duration) * width;
                
                // Draw latency area
                ctx.fillRect(startX, 0, endX - startX, height);
                
                // Draw vertical lines at start and end
                ctx.beginPath();
                ctx.moveTo(startX, 0);
                ctx.lineTo(startX, height);
                ctx.stroke();
                
                ctx.beginPath();
                ctx.moveTo(endX, 0);
                ctx.lineTo(endX, height);
                ctx.stroke();
                
                // Draw latency text
                ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                const textX = startX + (endX - startX) / 2;
                ctx.fillText(`${data.latency.toFixed(2)}s`, textX, height / 2);
            });
        }
    }

    // Draw a placeholder waveform when we can't generate the real one
    function drawPlaceholderWaveform(ctx) {
        const width = waveformCanvas.clientWidth;
        const height = waveformCanvas.clientHeight;
        const centerY = height / 2;
        
        // Clear the canvas
        ctx.clearRect(0, 0, width, height);
        
        // Set the waveform style
        ctx.lineWidth = 1;
        ctx.fillStyle = '#555555';
        
        // Draw some random bars to simulate a waveform
        const barCount = 100;
        const barWidth = Math.max(1, Math.floor(width / 200));
        const gap = Math.max(0, Math.floor(barWidth * 0.2));
        
        for (let i = 0; i < barCount; i++) {
            // Generate a random height for each bar
            const barHeight = Math.random() * height * 0.7;
            const x = i * ((width - (barWidth + gap) * barCount) / barCount + (barWidth + gap));
            
            // Draw the bar
            ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
        }
    }

    // Format time
    function formatTime(seconds) {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.round(seconds % 60);
        return `${minutes}:${remainingSeconds < 10 ? '0' : ''}${remainingSeconds}`;
    }

    // Add a function to calculate latency between frames
    function calculateLatencyData() {
        // Reset latency data
        latencyData = [];
        
        // We'll analyze frames to find user/AI pairs
        let lastUserFrame = null;
        
        // Filter frames by user and AI messages
        const messageFrames = allFrames.filter(frame => 
            frame.type === 'USER_MESSAGE' || frame.type === 'AI_RESPONSE'
        );
        
        // Calculate latency between pairs
        for (let i = 0; i < messageFrames.length; i++) {
            const frame = messageFrames[i];
            
            if (frame.type === 'USER_MESSAGE') {
                lastUserFrame = frame;
            } else if (frame.type === 'AI_RESPONSE' && lastUserFrame) {
                // Calculate latency between user message and AI response
                const latency = frame.timestamp - lastUserFrame.timestamp;
                
                // Store the latency data with timestamps
                latencyData.push({
                    userTimestamp: lastUserFrame.timestamp,
                    aiTimestamp: frame.timestamp,
                    latency: latency
                });
                
                lastUserFrame = null; // Reset for next pair
            }
        }
        
        // Calculate statistics
        if (latencyData.length > 0) {
            const totalLatency = latencyData.reduce((sum, data) => sum + data.latency, 0);
            const avgLatency = totalLatency / latencyData.length;
            
            console.log(`Average response latency: ${avgLatency.toFixed(3)}s over ${latencyData.length} messages`);
            
            // Create a small display for average latency
            const statsContainer = document.getElementById('stats-container');
            if (statsContainer) {
                const latencyElement = document.createElement('div');
                latencyElement.id = 'latency-stats';
                latencyElement.innerHTML = `<span title="Average response time">Avg. Latency: ${avgLatency.toFixed(3)}s</span>`;
                latencyElement.style.marginLeft = '1rem';
                latencyElement.style.opacity = '0.7';
                statsContainer.appendChild(latencyElement);
            }
        }
    }
    
    // Toggle latency display on the waveform
    function toggleLatencyDisplay() {
        isShowingLatency = !isShowingLatency;
        
        // If we have a canvas, redraw the waveform
        if (waveformCanvas && waveformCanvas.getContext && audioBuffer) {
            const ctx = waveformCanvas.getContext('2d');
            drawWaveform(ctx);
        }
        
        // Update the UI to show the current setting
        const latencyDisplayStatus = document.createElement('span');
        latencyDisplayStatus.classList.add('notification');
        latencyDisplayStatus.textContent = isShowingLatency ? 'Latency Display: ON' : 'Latency Display: OFF';
        latencyDisplayStatus.style.position = 'fixed';
        latencyDisplayStatus.style.bottom = '10px';
        latencyDisplayStatus.style.right = '10px';
        latencyDisplayStatus.style.background = 'rgba(0, 0, 0, 0.7)';
        latencyDisplayStatus.style.color = '#fff';
        latencyDisplayStatus.style.padding = '5px 10px';
        latencyDisplayStatus.style.borderRadius = '4px';
        latencyDisplayStatus.style.zIndex = '1000';
        document.body.appendChild(latencyDisplayStatus);
        
        // Remove notification after 2 seconds
        setTimeout(() => {
            document.body.removeChild(latencyDisplayStatus);
        }, 2000);
    }
    
    function toggleAudioSync() {
        if (!audioLoaded) return;
        
        audioSyncEnabled = !audioSyncEnabled;
        syncStatus.textContent = audioSyncEnabled ? 'Audio Sync: ON' : 'Audio Sync: OFF';
        
        // Show notification
        const syncNotification = document.createElement('span');
        syncNotification.classList.add('notification');
        syncNotification.textContent = audioSyncEnabled ? 'Audio Sync: ON' : 'Audio Sync: OFF';
        syncNotification.style.position = 'fixed';
        syncNotification.style.bottom = '10px';
        syncNotification.style.right = '10px';
        syncNotification.style.background = 'rgba(0, 0, 0, 0.7)';
        syncNotification.style.color = '#fff';
        syncNotification.style.padding = '5px 10px';
        syncNotification.style.borderRadius = '4px';
        syncNotification.style.zIndex = '1000';
        document.body.appendChild(syncNotification);
        
        // Remove notification after 2 seconds
        setTimeout(() => {
            document.body.removeChild(syncNotification);
        }, 2000);
    }

    // Initialize collapsible sections
    function initializeCollapsibleSections() {
        const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
        
        collapsibleHeaders.forEach(header => {
            const collapseBtn = header.querySelector('.collapse-btn');
            if (collapseBtn) {
                collapseBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const container = header.closest('.filter-container');
                    toggleCollapsible(container);
                });
            }
            
            // Make entire header clickable
            header.addEventListener('click', () => {
                const container = header.closest('.filter-container');
                toggleCollapsible(container);
            });
        });
        
        // Function to toggle a collapsible section
        function toggleCollapsible(container) {
            container.classList.toggle('collapsed');
            
            // Store the state in localStorage
            const headingText = container.querySelector('h3').textContent.trim();
            const isCollapsed = container.classList.contains('collapsed');
            localStorage.setItem(`collapsed_${headingText}`, isCollapsed);
        }
        
        // Restore collapsed state from localStorage
        document.querySelectorAll('.filter-container').forEach(container => {
            const headingText = container.querySelector('h3').textContent.trim();
            const wasCollapsed = localStorage.getItem(`collapsed_${headingText}`) === 'true';
            
            if (wasCollapsed) {
                container.classList.add('collapsed');
            }
        });
    }

    // Playback controls
    function startPlayback() {
        if (isPlaying) return;
        
        isPlaying = true;
        playBtn.style.display = 'none';
        pauseBtn.style.display = 'flex';
        
        // If audio is loaded and sync is enabled, use audio playback
        if (audioLoaded && audioSyncEnabled) {
            audioPlayer.play();
            return;
        }
        
        // Otherwise use manual frame playback
        const speed = parseFloat(speedSelect.value);
        const interval = 500 / speed; // Base interval is 500ms, adjusted by speed
        
        playbackInterval = setInterval(() => {
            stepForward();
            
            // If we reached the end, stop playback
            if (currentFrameIndex >= filteredFrames.length - 1) {
                stopPlayback();
            }
        }, interval);
    }
    
    function stopPlayback() {
        if (!isPlaying) return;
        
        isPlaying = false;
        
        // Stop audio if it's playing and sync is enabled
        if (audioLoaded && audioSyncEnabled) {
            audioPlayer.pause();
        }
        
        // Clear the interval for manual frame playback
        clearInterval(playbackInterval);
        
        // Update UI
        playBtn.style.display = 'flex';
        pauseBtn.style.display = 'none';
    }
    
    function resetPlayback() {
        stopPlayback();
        currentFrameIndex = 0;
        if (filteredFrames.length > 0) {
            timeSlider.value = filteredFrames[0].timestamp * 1000;
            currentTimeElement.textContent = filteredFrames[0].timestamp.toFixed(3);
            highlightCurrentFrame();
            
            // Reset audio to beginning if sync is enabled
            if (audioLoaded && audioSyncEnabled) {
                audioPlayer.currentTime = Math.max(0, filteredFrames[0].timestamp - audioOffset);
            }
        } else {
            timeSlider.value = 0;
            currentTimeElement.textContent = '0.000';
            
            // Reset audio to beginning if loaded
            if (audioLoaded) {
                audioPlayer.currentTime = 0;
            }
        }
    }
    
    function stepForward() {
        if (currentFrameIndex < filteredFrames.length - 1) {
            currentFrameIndex++;
            const frame = filteredFrames[currentFrameIndex];
            timeSlider.value = frame.timestamp * 1000;
            currentTimeElement.textContent = frame.timestamp.toFixed(3);
            
            // Update audio position if sync is enabled
            if (audioLoaded && audioSyncEnabled) {
                audioPlayer.currentTime = Math.max(0, frame.timestamp - audioOffset);
            }
            
            highlightCurrentFrame();
            
            // Scroll to the current frame
            scrollToCurrentFrame();
        }
    }
    
    function stepBackward() {
        if (currentFrameIndex > 0) {
            currentFrameIndex--;
            const frame = filteredFrames[currentFrameIndex];
            timeSlider.value = frame.timestamp * 1000;
            currentTimeElement.textContent = frame.timestamp.toFixed(3);
            
            // Update audio position if sync is enabled
            if (audioLoaded && audioSyncEnabled) {
                audioPlayer.currentTime = Math.max(0, frame.timestamp - audioOffset);
            }
            
            highlightCurrentFrame();
            
            // Scroll to the current frame
            scrollToCurrentFrame();
        }
    }

    // Add keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Only trigger when not typing in an input field
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        if (e.key === ' ' || e.code === 'Space') {
            e.preventDefault(); // Prevent page scroll
            if (isPlaying) {
                stopPlayback();
            } else {
                startPlayback();
            }
        } else if (e.key === 's' || e.key === 'S') {
            toggleAudioSync();
        } else if (e.key === 'l' || e.key === 'L') {
            toggleLatencyDisplay();
        }
    });
}); 