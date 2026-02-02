import React from 'react';
import UrlInput from './UrlInput';
import logoLight from '../assets/logo-light.png';
import logoDark from '../assets/logo-dark.png';

const SearchSection = ({ theme, hasVideos, isSingleVideo, onAnalyze, isLoading }) => {
    return (
        <div className={`center-container ${hasVideos ? (isSingleVideo ? 'moved-up-single' : 'moved-up') : ''}`}>
            <div className="logo-container">
                <img
                    src={logoLight}
                    className={`logo-image ${theme === 'light' ? 'active' : 'inactive'}`}
                    alt="YouTube Logo"
                />
                <img
                    src={logoDark}
                    className={`logo-image ${theme === 'dark' ? 'active' : 'inactive'}`}
                    alt="YouTube Logo"
                />
            </div>

            <UrlInput onAnalyze={onAnalyze} isLoading={isLoading} />
        </div>
    );
};

export default SearchSection;
