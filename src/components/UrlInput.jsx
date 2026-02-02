import React, { useState } from 'react';

const UrlInput = ({ onAnalyze, isLoading }) => {
    const [url, setUrl] = useState('');

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && url.trim()) {
            onAnalyze(url);
        }
    };

    const handleSearchClick = () => {
        if (url.trim()) {
            onAnalyze(url);
        }
    };

    return (
        <div className="input-container">
            <input
                id="url-input"
                name="url"
                type="text"
                autoComplete="off"
                className="url-input"
                placeholder="Paste Youtube Playlist, Video or Shorts URL..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={isLoading}
            />
            <svg
                className="search-icon"
                onClick={handleSearchClick}
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M21 21L15 15M17 10C17 13.866 13.866 17 10 17C6.13401 17 3 13.866 3 10C3 6.13401 6.13401 3 10 3C13.866 3 17 6.13401 17 10Z"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        </div>
    );
};

export default UrlInput;