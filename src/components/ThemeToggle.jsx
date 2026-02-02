import React from 'react';
import iconSun from '../assets/icon-sun.png';
import iconMoon from '../assets/icon-moon.png';

const ThemeToggle = ({ theme, toggleTheme }) => {
    return (
        <div className="theme-switch" onClick={toggleTheme}>
            <svg xmlns="http://www.w3.org/2000/svg" width="50" height="30" viewBox="0 0 50 30" fill="none">
                <rect
                    width="50"
                    height="30"
                    rx="15"
                    fill={theme === 'light' ? "#D9D9D9" : "#303134"}
                    style={{ transition: 'var(--transition-speed)' }}
                />
                <g className="toggle-icon">
                    <image
                        className={`theme-icon ${theme === 'light' ? 'active' : ''}`}
                        href={iconSun}
                        x="5"
                        y="5"
                        height="20"
                        width="20"
                    />
                    <image
                        className={`theme-icon ${theme === 'dark' ? 'active' : ''}`}
                        href={iconMoon}
                        x="5"
                        y="5"
                        height="20"
                        width="20"
                    />
                </g>
            </svg>
        </div>
    );
};

export default ThemeToggle;
