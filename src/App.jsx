import React, { useState, useEffect, useRef } from 'react';
import ThemeToggle from './components/ThemeToggle';
import SearchSection from './components/SearchSection';
import PlaylistViewer from './components/PlaylistViewer';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { listen } from '@tauri-apps/api/event';

// Removed API_BASE and WS_BASE

function App() {
  const [videos, setVideos] = useState([]);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [format, setFormat] = useState(localStorage.getItem('format') || 'mp4'); // 'mp4' or 'mp3'
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isChecking, setIsChecking] = useState(false);

  const [downloadId, setDownloadId] = useState(null);
  const [activeDownloads, setActiveDownloads] = useState({}); // id -> progress string
  const [totalToDownload, setTotalToDownload] = useState(0);
  const [completedVideoIds, setCompletedVideoIds] = useState(new Set());
  const [status, setStatus] = useState('');
  const [lastOutcome, setLastOutcome] = useState(null); // 'complete' | 'paused' | 'canceled'
  const [downloadDir, setDownloadDir] = useState(localStorage.getItem('downloadDir') || null);
  const [concurrencyLimit, setConcurrencyLimit] = useState(parseInt(localStorage.getItem('concurrencyLimit')) || 1);
  const [isConcurrencyDropdownOpen, setIsConcurrencyDropdownOpen] = useState(false);

  // Lifted theme state
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');

  const unlistenRef = useRef(null);
  const videosRef = useRef([]);
  const userStoppedRef = useRef(null); // 'pause' | 'cancel' when user intentionally stopped

  useEffect(() => {
    invoke('greet', { name: 'World' })
      .then(console.log)
      .catch(console.error);
  }, []);

  useEffect(() => {
    videosRef.current = videos;
    document.body.className = theme === 'light' ? 'light-mode' : 'dark-mode';
    localStorage.setItem('theme', theme);
  }, [theme, videos]);

  useEffect(() => {
    localStorage.setItem('format', format);
  }, [format]);

  useEffect(() => {
    localStorage.setItem('concurrencyLimit', concurrencyLimit);
  }, [concurrencyLimit]);

  const toggleTheme = () => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  };

  useEffect(() => {
    // Setup event listener for progress
    const setupListener = async () => {
      // Unlisten if already listening
      if (unlistenRef.current) {
        unlistenRef.current();
      }

      const unlisten = await listen('download-progress', (event) => {
        const { id, message } = event.payload;
        // Update specific video progress
        setActiveDownloads(prev => ({ ...prev, [id]: message }));
        setStatus(`Downloading ${Object.keys(activeDownloads).length} videos...`);

        // Check if it looks like completion or error
        // For now, since sidecar is simple, we rely on the command finishing in handleDownload
      });
      unlistenRef.current = unlisten;
    };

    setupListener();

    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);

  const handleAnalyze = async (url) => {
    setLoading(true);
    setStatus('Analyzing playlist...');
    try {
      const videos = await invoke('analyze_playlist', { url });
      console.log("Analyzed videos:", videos);

      setVideos(videos);
      setSelectedIds(new Set(videos.map(v => v.id)));
      setLastOutcome(null);
      setStatus(`Found ${videos.length} videos`);
    } catch (e) {
      console.error(e);
      setStatus(`Error: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const toggleSelection = (id) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const handleDownload = async (isResume = false) => {
    userStoppedRef.current = null;
    setLastOutcome(null);
    setDownloading(true);
    setIsPaused(false);
    setIsChecking(true);
    setStatus(isResume === true ? 'Resuming download...' : 'Initiating download...');

    if (isResume !== true) {
      setCompletedVideoIds(new Set());
    }

    const videosToDownload = videos
      .filter(v => selectedIds.has(v.id))
      .filter(v => isResume === true ? !completedVideoIds.has(v.id) : true);

    if (isResume !== true) {
      setTotalToDownload(videos.filter(v => selectedIds.has(v.id)).length);
    }

    if (videosToDownload.length === 0) {
      setStatus('All selected videos already downloaded');
      setDownloading(false);
      setLastOutcome('complete');
      return;
    }

    const queue = [...videosToDownload];
    const activePromises = [];

    const processNext = async () => {
      if (userStoppedRef.current) return;

      // Atomic pop
      if (queue.length === 0) return;
      const video = queue.shift();

      // Start download
      setActiveDownloads(prev => ({ ...prev, [video.id]: 'Starting...' }));
      try {
        await invoke('download_video', {
          id: video.id,
          url: video.url,
          format: format,
          downloadDir: downloadDir
        });
        setCompletedVideoIds(prev => new Set(prev).add(video.id));
      } catch (e) {
        console.error(`Error downloading ${video.id}:`, e);
        // Optionally track errors
      } finally {
        setActiveDownloads(prev => {
          const next = { ...prev };
          delete next[video.id];
          return next;
        });
      }

      // Loop
      await processNext();
    };

    // Start initial workers
    for (let i = 0; i < Math.min(concurrencyLimit, videosToDownload.length); i++) {
      activePromises.push(processNext());
    }

    try {
      await Promise.all(activePromises);

      if (!userStoppedRef.current) {
        setStatus('All downloads finished');
        setLastOutcome('complete');
      }
    } catch (e) {
      setStatus(`Queue Error: ${e}`);
    } finally {
      setDownloading(false);
      setIsChecking(false);
    }
  };

  const handlePause = async () => {
    userStoppedRef.current = 'pause';
    setStatus('Pausing...');
    const activeIds = Object.keys(activeDownloads);
    if (activeIds.length > 0) {
      try {
        await Promise.all(activeIds.map(id => invoke('stop_download', { id })));
      } catch (e) {
        console.error("Error stopping downloads:", e);
      }
    }

    setStatus('Download paused');
    setLastOutcome('paused');
    setDownloading(false);
    setIsPaused(true);
  };

  const handleCancel = async () => {
    userStoppedRef.current = 'cancel';
    setStatus('Canceling...');

    const activeIds = Object.keys(activeDownloads);
    if (activeIds.length > 0) {
      try {
        await Promise.all(activeIds.map(id => invoke('stop_download', { id })));
      } catch (e) {
        console.error("Error cancelling downloads:", e);
      }
    }

    setDownloading(false);
    setDownloadId(null);
    setIsPaused(false);
    setStatus('Canceled');
    setLastOutcome('canceled');
  };

  const clearDownloadStatus = () => setLastOutcome(null);

  // Update Page Title with Progress
  useEffect(() => {
    if (downloading && totalToDownload > 0) {
      const currentCount = completedVideoIds.size + 1;
      const displayCount = currentCount > totalToDownload ? totalToDownload : currentCount;
      document.title = `frontend - (${displayCount}/${totalToDownload})`;
    } else {
      document.title = 'frontend';
    }
  }, [downloading, completedVideoIds.size, totalToDownload]);

  const selectDownloadDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: downloadDir || undefined,
      });
      if (selected) {
        setDownloadDir(selected);
        localStorage.setItem('downloadDir', selected);
      }
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <>
      <div className="logo-card">
        <div className="logo-card-bg"></div>
        <div className="logo-card-outline"></div>
        <div className="logo-card-blob"></div>
      </div>
      <SearchSection
        theme={theme}
        hasVideos={videos.length > 0}
        isSingleVideo={videos.length === 1}
        onAnalyze={handleAnalyze}
        isLoading={loading}
      />

      <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginBottom: '1rem', alignItems: 'center' }}>
        <button onClick={selectDownloadDir} style={{ padding: '8px 16px', borderRadius: '4px', cursor: 'pointer' }}>
          {downloadDir ? `Location: ${downloadDir}` : 'Select Download Location'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-color)' }}>
          <span style={{ fontSize: '0.9rem' }}>Concurrency:</span>

          <div style={{ position: 'relative' }}>
            <div
              onClick={() => setIsConcurrencyDropdownOpen(!isConcurrencyDropdownOpen)}
              style={{
                minWidth: '60px',
                padding: '8px 12px',
                borderRadius: '4px',
                border: '1px solid var(--border-color, #ccc)',
                cursor: 'pointer',
                background: 'var(--card-bg, #fff)',
                color: 'var(--text-color, #000)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                userSelect: 'none'
              }}
            >
              <span>{concurrencyLimit}</span>
              <span style={{ fontSize: '0.8em', marginLeft: '5px' }}>▼</span>
            </div>

            {isConcurrencyDropdownOpen && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: '0',
                width: '98%',
                maxHeight: '200px',
                overflowY: 'auto',
                background: 'var(--card-bg, #fff)',
                border: '1px solid var(--border-color, #ccc)',
                borderRadius: '4px',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                zIndex: 1000
              }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(num => (
                  <div
                    key={num}
                    onClick={() => {
                      setConcurrencyLimit(num);
                      setIsConcurrencyDropdownOpen(false);
                    }}
                    style={{
                      padding: '8px 12px',
                      cursor: 'pointer',
                      background: concurrencyLimit === num ? 'var(--hover-color, rgba(0,0,0,0.1))' : 'transparent',
                      color: 'var(--text-color, #000)',
                      textAlign: 'center'
                    }}
                    onMouseEnter={(e) => e.target.style.background = 'var(--hover-color, rgba(0,0,0,0.1))'}
                    onMouseLeave={(e) => e.target.style.background = concurrencyLimit === num ? 'var(--hover-color, rgba(0,0,0,0.1))' : 'transparent'}
                  >
                    {num}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ThemeToggle theme={theme} toggleTheme={toggleTheme} />

      <div className={`footer-curve ${videos.length > 0 ? 'active' : ''} ${videos.length === 1 ? 'single-active' : ''}`}>
        <PlaylistViewer
          videos={videos}
          selectedIds={selectedIds}
          onToggle={toggleSelection}
          selectAll={() => setSelectedIds(new Set(videos.map(v => v.id)))}
          unselectAll={() => setSelectedIds(new Set())}
          format={format}
          setFormat={setFormat}
          onDownload={handleDownload}
          onCancel={handleCancel}
          onPause={handlePause}
          isDownloading={downloading}
          isPaused={isPaused}
          isChecking={isChecking}
          totalToDownload={totalToDownload}
          completedVideoIds={completedVideoIds}
          activeDownloads={activeDownloads}
          onClearCompleted={() => setCompletedVideoIds(new Set())}
          onClearStatus={clearDownloadStatus}
          lastOutcome={lastOutcome}
          status={status}
        />
      </div>
    </>
  );
}


export default App;